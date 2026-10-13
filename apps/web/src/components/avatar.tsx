import { avatarUrl } from "@/lib/roles";

/** Profile photo, or initials on the accent tint when there's no photo yet. */
export function Avatar({
  name,
  email,
  avatarPath,
  size = 32,
}: {
  name?: string | null;
  email: string;
  avatarPath?: string | null;
  size?: number;
}) {
  const url = avatarUrl(avatarPath);
  const label = (name?.trim() || email).trim();
  const initials = label
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  if (url) {
    return (
      // Public storage URL; next/image would need the Supabase host added to images.remotePatterns.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials || "?"}
    </span>
  );
}
