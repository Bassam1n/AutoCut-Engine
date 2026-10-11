# services/render

Dockerized ffmpeg render service. Claims jobs from a Postgres queue
(`for update skip locked`), runs assembly/captions/overlays, uploads the
result to Supabase Storage. Outbound only, no inbound port. See spec §6 M10.
