"""Re-imports Auto-edit's project exports with OpenTimelineIO's readers.

The vitest suite (src/lib/auto-edit/exports/exports.test.ts) writes, for
each fixture plan, the Premiere XML (FCP 7 xmeml), the FCPXML and the
.otio, plus <label>.expected.json with what the timeline should hold.
This script reads every file back with an independent parser and checks
it describes the same edit: well-formed XML, the footage clips with the
same trims and order, the cross dissolves, the graphics at the same
times, the voiceover.

    pip install opentimelineio==0.18.1 otio-fcp-adapter==1.0.0 otio-fcpx-xml-adapter==1.0.0
    EXPORT_FIXTURE_DIR=/tmp/exports npx vitest run src/lib/auto-edit/exports
    python scripts/validate-exports.py /tmp/exports
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import opentimelineio as otio


def fail(msg):
    print(f"FAIL {msg}")
    sys.exit(1)


def frames(t):
    return round(t.to_frames(30)) if t.rate != 30 else round(t.value)


def video_tracks(tl):
    return [t for t in tl.tracks if t.kind == otio.schema.TrackKind.Video]


def audio_tracks(tl):
    return [t for t in tl.tracks if t.kind == otio.schema.TrackKind.Audio]


def check_footage(label, fmt, track, expected):
    clips = [c for c in track if isinstance(c, otio.schema.Clip)]
    if len(clips) != len(expected["video"]):
        fail(f"{label}.{fmt}: {len(clips)} footage clips, expected {len(expected['video'])}")
    for clip, exp in zip(clips, expected["video"]):
        rng = track.range_of_child(clip)
        src = clip.source_range
        if frames(src.duration) != exp["duration"]:
            fail(f"{label}.{fmt}: clip {exp['name']} lasts {frames(src.duration)} frames, expected {exp['duration']}")
        if frames(src.start_time) != exp["in"]:
            fail(f"{label}.{fmt}: clip {exp['name']} starts at source frame {frames(src.start_time)}, expected {exp['in']}")
        url = getattr(clip.media_reference, "target_url", "") or ""
        if not url.endswith(exp["file"].split("/")[-1]):
            fail(f"{label}.{fmt}: clip {exp['name']} points at {url}, expected {exp['file']}")
        del rng
    transitions = [t for t in track if isinstance(t, otio.schema.Transition)]
    want = sum(1 for v in expected["video"] if v["transitionIn"])
    if len(transitions) != want:
        fail(f"{label}.{fmt}: {len(transitions)} transitions, expected {want}")
    for tr, exp in zip(transitions, [v for v in expected["video"] if v["transitionIn"]]):
        total = frames(tr.in_offset) + frames(tr.out_offset)
        if total != exp["transitionIn"]:
            fail(f"{label}.{fmt}: transition of {total} frames, expected {exp['transitionIn']}")


def check_overlays(label, fmt, tracks, expected):
    found = []
    for track in tracks:
        for clip in track:
            if isinstance(clip, otio.schema.Clip):
                rng = track.range_of_child(clip)
                found.append((frames(rng.start_time), frames(rng.duration)))
    want = sorted((o["start"], o["duration"]) for o in expected["overlays"])
    if sorted(found) != want:
        fail(f"{label}.{fmt}: graphics at {sorted(found)}, expected {want}")


def seconds(v):
    v = v.rstrip("s")
    if "/" in v:
        n, d = v.split("/")
        return float(n) / float(d)
    return float(v)


def check_fcpxml_transitions(label, path, expected):
    spine = ET.parse(path).getroot().find(".//sequence/spine")
    items = list(spine)
    want = [v for v in expected["video"] if v["transitionIn"]]
    found = [(i, el) for i, el in enumerate(items) if el.tag == "transition"]
    if len(found) != len(want):
        fail(f"{label}.fcpxml: {len(found)} transitions, expected {len(want)}")
    for (i, tr), exp in zip(found, want):
        before, after = items[i - 1], items[i + 1]
        if before.tag != "asset-clip" or after.tag != "asset-clip":
            fail(f"{label}.fcpxml: a transition must sit between two clips")
        cut = seconds(after.get("offset"))
        dur = seconds(tr.get("duration"))
        if round(dur * 30) != exp["transitionIn"] or abs(seconds(tr.get("offset")) - (cut - dur / 2)) > 1e-6:
            fail(f"{label}.fcpxml: transition at {tr.get('offset')} for {tr.get('duration')} isn't centred on the cut at {after.get('offset')}")


def check(label, path, fmt, adapter, expected):
    if fmt != "otio":
        ET.parse(path)  # well-formed
    tl = otio.adapters.read_from_file(str(path), adapter_name=adapter)
    if isinstance(tl, otio.schema.SerializableCollection):
        timelines = [t for t in tl.find_children(descended_from_type=otio.schema.Timeline)] or [t for t in tl if isinstance(t, otio.schema.Timeline)]
        if len(timelines) != 1:
            fail(f"{label}.{fmt}: {len(timelines)} timelines, expected 1")
        tl = timelines[0]
    if fmt == "fcpxml":
        # OTIO's FCPXML reader makes one track per lane, named by lane
        # number (the voiceover's lane -1 included), and doesn't read
        # transitions, so those are checked in the XML itself below.
        lanes = {t.name: t for t in tl.tracks}
        check_footage(label, fmt, lanes["0"], dict(expected, video=[dict(v, transitionIn=0) for v in expected["video"]]))
        check_overlays(label, fmt, [t for name, t in lanes.items() if name in ("1", "2")], expected)
        check_fcpxml_transitions(label, path, expected)
        vt = [lanes["0"]]
        audio = [lanes["-1"]] if "-1" in lanes else []
    else:
        vt = video_tracks(tl)
        if len(vt) != 3:
            fail(f"{label}.{fmt}: {len(vt)} video tracks, expected 3")
        check_footage(label, fmt, vt[0], expected)
        check_overlays(label, fmt, vt[1:], expected)
        audio = audio_tracks(tl)
    vo = []
    for track in audio:
        for clip in track:
            if isinstance(clip, otio.schema.Clip) and "voiceover" in (getattr(clip.media_reference, "target_url", "") or ""):
                rng = track.range_of_child(clip)
                vo.append((frames(rng.start_time), frames(rng.duration)))
    want = [(v["start"], v["duration"]) for v in expected["voiceover"]]
    if sorted(vo) != sorted(want):
        fail(f"{label}.{fmt}: voiceover at {vo}, expected {want}")
    print(f"ok   {label}.{fmt}: {len(vt)} video tracks, {len(expected['video'])} footage clips, {len(expected['overlays'])} graphics, {len(want)} voiceover")


def main(directory):
    d = Path(directory)
    labels = sorted(p.name[: -len(".expected.json")] for p in d.glob("*.expected.json"))
    if not labels:
        fail(f"no fixtures in {d}")
    for label in labels:
        expected = json.loads((d / f"{label}.expected.json").read_text())
        check(label, d / f"{label}.xml", "xml", "fcp_xml", expected)
        check(label, d / f"{label}.fcpxml", "fcpxml", "fcpx_xml", expected)
        check(label, d / f"{label}.otio", "otio", "otio_json", expected)
    print("all exports re-import cleanly")


if __name__ == "__main__":
    main(sys.argv[1])
