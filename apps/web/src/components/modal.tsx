"use client";

/**
 * Shared in-page modal, replacing browser-native window.prompt()/
 * window.confirm() dialogs everywhere — those can't show images or
 * any real content, feel out of place, and are flagged as poor
 * practice. Click outside or the ✕ closes; content never closes on
 * its own.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="card flex w-full max-w-sm flex-col gap-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Simple text-input confirm modal — the narrowest replacement for window.prompt(). */
export function PromptModal({
  title,
  label,
  placeholder,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <PromptModalForm label={label} placeholder={placeholder} onSubmit={onSubmit} />
    </Modal>
  );
}

function PromptModalForm({
  label,
  placeholder,
  onSubmit,
}: {
  label: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = new FormData(e.currentTarget).get("value");
        onSubmit(String(value ?? ""));
      }}
      className="flex flex-col gap-2"
    >
      <label className="text-xs font-medium">{label}</label>
      <input
        name="value"
        placeholder={placeholder}
        autoFocus
        className="field"
      />
      <button
        type="submit"
        className="btn-primary btn-sm self-start"
      >
        Confirm
      </button>
    </form>
  );
}
