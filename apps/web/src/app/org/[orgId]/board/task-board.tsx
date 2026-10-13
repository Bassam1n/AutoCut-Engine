"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Modal } from "@/components/modal";
import { Avatar } from "@/components/avatar";
import type { BoardData, Task, TaskColumn } from "./board-data";
import {
  addColumn,
  archiveTask,
  createTask,
  moveTask,
  removeColumn,
  renameColumn,
  shiftColumn,
  updateTask,
  type TaskInput,
} from "./board-actions";

/**
 * Kanban board. "manage" (owners/admins): every task, create/edit,
 * column management, filters. "mine" (users): only their own tasks,
 * which they can drag between columns or move from the task sheet.
 * Drag and drop is native HTML5; the "Move to" select in the task sheet
 * covers touch screens, where HTML5 drag doesn't fire.
 */
export function TaskBoard({
  orgId,
  mode,
  data,
  viewer,
}: {
  orgId: string;
  mode: "manage" | "mine";
  data: BoardData;
  viewer: { id: string; email: string; name: string | null; avatarPath: string | null };
}) {
  const manage = mode === "manage";
  const [tasks, setTasks] = useState<Task[]>(data.tasks);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [newTaskColumn, setNewTaskColumn] = useState<string | null>(null);

  // Server data wins after each revalidation; local state only bridges the round trip.
  const [syncedFrom, setSyncedFrom] = useState(data.tasks);
  if (syncedFrom !== data.tasks) {
    setSyncedFrom(data.tasks);
    setTasks(data.tasks);
  }

  const brandName = useMemo(() => new Map(data.brands.map((b) => [b.id, b.name])), [data.brands]);
  const personById = useMemo(() => {
    const map = new Map(data.people.map((p) => [p.id, p]));
    if (!map.has(viewer.id)) {
      map.set(viewer.id, { id: viewer.id, email: viewer.email, name: viewer.name, avatarPath: viewer.avatarPath });
    }
    return map;
  }, [data.people, viewer]);

  const visible = tasks.filter(
    (t) =>
      (!assigneeFilter || (assigneeFilter === "none" ? !t.assignee_id : t.assignee_id === assigneeFilter)) &&
      (!brandFilter || t.brand_id === brandFilter)
  );

  function tasksIn(columnId: string) {
    return visible.filter((t) => t.column_id === columnId).sort((a, b) => a.position - b.position);
  }

  /** Position for dropping before `beforeTaskId` in a column (or at the end). */
  function positionFor(columnId: string, beforeTaskId: string | null, movingId: string): number {
    const list = tasks
      .filter((t) => t.column_id === columnId && t.id !== movingId)
      .sort((a, b) => a.position - b.position);
    if (list.length === 0) return 1;
    if (!beforeTaskId) return list[list.length - 1].position + 1;
    const i = list.findIndex((t) => t.id === beforeTaskId);
    if (i <= 0) return list[0].position - 1;
    return (list[i - 1].position + list[i].position) / 2;
  }

  function move(taskId: string, columnId: string, beforeTaskId: string | null) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const position = positionFor(columnId, beforeTaskId, taskId);
    if (task.column_id === columnId && task.position === position) return;

    const previous = tasks;
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, column_id: columnId, position } : t)));
    setError(null);
    startTransition(async () => {
      const result = await moveTask(orgId, taskId, columnId, position);
      if (!result.ok) {
        setTasks(previous);
        setError(result.error);
      }
    });
  }

  function onDrop(columnId: string, beforeTaskId: string | null) {
    if (dragTaskId) move(dragTaskId, columnId, beforeTaskId);
    setDragTaskId(null);
    setDropColumnId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {manage && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by assignee"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="field field-sm"
          >
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name?.trim() || p.email}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by brand"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="field field-sm"
          >
            <option value="">All brands</option>
            {data.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setNewTaskColumn(data.columns[0]?.id ?? null)}
            disabled={data.columns.length === 0}
            className="btn-primary btn-sm ml-auto"
          >
            New task
          </button>
        </div>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
        {data.columns.map((column, index) => (
          <Column
            key={column.id}
            orgId={orgId}
            column={column}
            manage={manage}
            isFirst={index === 0}
            isLast={index === data.columns.length - 1}
            tasks={tasksIn(column.id)}
            isDropTarget={dropColumnId === column.id}
            onDragOverColumn={() => setDropColumnId(column.id)}
            onDropAt={(beforeTaskId) => onDrop(column.id, beforeTaskId)}
            onAddTask={() => setNewTaskColumn(column.id)}
            onError={setError}
          >
            {(task) => (
              <TaskCard
                key={task.id}
                task={task}
                brandName={task.brand_id ? brandName.get(task.brand_id) : undefined}
                assignee={task.assignee_id ? personById.get(task.assignee_id) : undefined}
                showAssignee={manage}
                finished={column.stage === "done" || column.stage === "delivered"}
                isDragging={dragTaskId === task.id}
                onDragStart={() => setDragTaskId(task.id)}
                onDragEnd={() => {
                  setDragTaskId(null);
                  setDropColumnId(null);
                }}
                onDropBefore={() => onDrop(column.id, task.id)}
                onOpen={() => setOpenTask(task)}
              />
            )}
          </Column>
        ))}
        {manage && <AddColumn orgId={orgId} onError={setError} />}
      </div>

      {!manage && tasks.length === 0 && (
        <p className="text-sm text-foreground-muted">No tasks assigned to you yet.</p>
      )}

      {openTask && (
        <TaskSheet
          orgId={orgId}
          task={openTask}
          manage={manage}
          data={data}
          brandName={openTask.brand_id ? brandName.get(openTask.brand_id) : undefined}
          onMove={(columnId) => {
            move(openTask.id, columnId, null);
            setOpenTask(null);
          }}
          onClose={() => setOpenTask(null)}
        />
      )}

      {newTaskColumn && (
        <TaskSheet
          orgId={orgId}
          task={null}
          defaultColumnId={newTaskColumn}
          manage
          data={data}
          newPosition={positionFor(newTaskColumn, null, "")}
          onMove={() => {}}
          onClose={() => setNewTaskColumn(null)}
        />
      )}
    </div>
  );
}

function Column({
  orgId,
  column,
  manage,
  isFirst,
  isLast,
  tasks,
  isDropTarget,
  onDragOverColumn,
  onDropAt,
  onAddTask,
  onError,
  children,
}: {
  orgId: string;
  column: TaskColumn;
  manage: boolean;
  isFirst: boolean;
  isLast: boolean;
  tasks: Task[];
  isDropTarget: boolean;
  onDragOverColumn: () => void;
  onDropAt: (beforeTaskId: string | null) => void;
  onAddTask: () => void;
  onError: (error: string | null) => void;
  children: (task: Task) => React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    onError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) onError(result.error ?? "Something went wrong.");
    });
  }

  return (
    <section
      aria-label={column.name}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverColumn();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropAt(null);
      }}
      className={`card-inset flex w-72 shrink-0 flex-col gap-2 p-2.5 transition-colors ${
        isDropTarget ? "border-accent" : ""
      }`}
    >
      <header className="flex items-center gap-1.5 px-1 pt-0.5">
        {renaming ? (
          <form
            className="flex flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              setRenaming(false);
              if (name.trim() && name.trim() !== column.name) run(() => renameColumn(orgId, column.id, name));
            }}
          >
            <input
              autoFocus
              aria-label="Column name"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className="field field-sm flex-1"
            />
          </form>
        ) : (
          <h2 className="flex-1 truncate text-sm font-semibold">
            {column.name}
            <span className="ml-1.5 text-xs font-normal text-foreground-muted">{tasks.length}</span>
          </h2>
        )}
        {manage && !renaming && (
          <div className="flex items-center">
            <button
              type="button"
              title="Add a task to this column"
              aria-label={`Add a task to ${column.name}`}
              onClick={onAddTask}
              className="btn-ghost btn-xs"
            >
              +
            </button>
            <details className="relative">
              <summary
                aria-label={`${column.name} options`}
                className="btn-ghost btn-xs cursor-pointer list-none"
              >
                ⋯
              </summary>
              <div className="card absolute right-0 z-20 mt-1 flex w-40 flex-col p-1 text-sm">
                <button type="button" onClick={() => setRenaming(true)} className="rounded-lg px-2 py-1.5 text-left hover:bg-border/40">
                  Rename
                </button>
                {!isFirst && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => shiftColumn(orgId, column.id, -1))}
                    className="rounded-lg px-2 py-1.5 text-left hover:bg-border/40"
                  >
                    Move left
                  </button>
                )}
                {!isLast && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => shiftColumn(orgId, column.id, 1))}
                    className="rounded-lg px-2 py-1.5 text-left hover:bg-border/40"
                  >
                    Move right
                  </button>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (window.confirm(`Remove "${column.name}"? Its tasks move to the first column.`)) {
                      run(() => removeColumn(orgId, column.id));
                    }
                  }}
                  className="rounded-lg px-2 py-1.5 text-left text-danger hover:bg-danger-soft"
                >
                  Remove column
                </button>
              </div>
            </details>
          </div>
        )}
      </header>

      <div className="flex min-h-16 flex-col gap-2">{tasks.map((task) => children(task))}</div>
    </section>
  );
}

function formatDue(dueDate: string): string {
  const [y, m, d] = dueDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function localTodayKey(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

const noSubscribe = () => () => {};

/**
 * Today's date in the viewer's own timezone. Read only in the browser
 * (null during server render), so "Overdue" never depends on the
 * server's clock or timezone.
 */
function useTodayKey(): string | null {
  return useSyncExternalStore(noSubscribe, localTodayKey, () => null);
}

function TaskCard({
  task,
  brandName,
  assignee,
  showAssignee,
  finished,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onOpen,
}: {
  task: Task;
  brandName?: string;
  assignee?: { id: string; email: string; name: string | null; avatarPath?: string | null };
  showAssignee: boolean;
  finished: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
  onOpen: () => void;
}) {
  const todayKey = useTodayKey();
  const overdue = Boolean(task.due_date && !finished && todayKey && task.due_date < todayKey);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropBefore();
      }}
      onClick={onOpen}
      className={`card card-interactive flex flex-col gap-2 p-3 text-left ${isDragging ? "opacity-40" : ""}`}
    >
      <span className="text-sm font-medium leading-snug">{task.title}</span>
      {(brandName || task.due_date || (showAssignee && assignee)) && (
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {brandName && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{brandName}</span>
          )}
          {task.due_date && (
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                overdue ? "bg-danger-soft text-danger" : "border border-border text-foreground-muted"
              }`}
            >
              {overdue ? "Overdue · " : "Due "}
              {formatDue(task.due_date)}
            </span>
          )}
          {showAssignee && assignee && (
            <span className="ml-auto" title={assignee.name?.trim() || assignee.email}>
              <Avatar name={assignee.name} email={assignee.email} avatarPath={assignee.avatarPath} size={22} />
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function TaskSheet({
  orgId,
  task,
  defaultColumnId,
  manage,
  data,
  brandName,
  newPosition,
  onMove,
  onClose,
}: {
  orgId: string;
  task: Task | null;
  defaultColumnId?: string;
  manage: boolean;
  data: BoardData;
  brandName?: string;
  newPosition?: number;
  onMove: (columnId: string) => void;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [brandId, setBrandId] = useState(task?.brand_id ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [columnId, setColumnId] = useState(task?.column_id ?? defaultColumnId ?? data.columns[0]?.id ?? "");

  // With a brand picked, only users assigned to that brand can take the task.
  const eligiblePeople = brandId
    ? data.people.filter((p) => (data.brandAssignees[brandId] ?? []).includes(p.id))
    : data.people;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: TaskInput = {
      title,
      description,
      brandId: brandId || null,
      assigneeId: assigneeId || null,
      dueDate: dueDate || null,
      columnId,
    };
    startTransition(async () => {
      const result = task
        ? await updateTask(orgId, task.id, input)
        : await createTask(orgId, input, newPosition ?? 1);
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  function archive() {
    if (!task || !window.confirm("Archive this task? It will disappear from the board.")) return;
    startTransition(async () => {
      const result = await archiveTask(orgId, task.id);
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  if (!manage && task) {
    return (
      <Modal title={task.title} onClose={onClose}>
        <div className="flex flex-col gap-4 text-sm">
          {task.description ? (
            <p className="whitespace-pre-wrap text-foreground-muted">{task.description}</p>
          ) : (
            <p className="text-foreground-muted">No description.</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {brandName && (
              <>
                <dt className="text-foreground-muted">Brand</dt>
                <dd>{brandName}</dd>
              </>
            )}
            {task.due_date && (
              <>
                <dt className="text-foreground-muted">Due</dt>
                <dd>{formatDue(task.due_date)}</dd>
              </>
            )}
          </dl>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Move to</span>
            <select
              value={task.column_id}
              onChange={(e) => onMove(e.target.value)}
              className="field"
            >
              {data.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Title</span>
          <input
            required
            autoFocus
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
            className="field"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Description</span>
          <textarea
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isPending}
            className="field resize-none"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Brand</span>
            <select
              value={brandId}
              onChange={(e) => {
                const next = e.target.value;
                setBrandId(next);
                if (next && assigneeId && !(data.brandAssignees[next] ?? []).includes(assigneeId)) {
                  setAssigneeId("");
                }
              }}
              disabled={isPending}
              className="field"
            >
              <option value="">No brand</option>
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Assignee</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={isPending}
              className="field"
            >
              <option value="">Unassigned</option>
              {eligiblePeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name?.trim() || p.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Due date</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={isPending}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Column</span>
            <select
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              disabled={isPending}
              className="field"
            >
              {data.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {brandId && eligiblePeople.length === 0 && (
          <p className="text-xs text-foreground-muted">
            No users are assigned to this brand yet. Assign one from the brand&apos;s edit page.
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" disabled={isPending} className="btn-primary btn-sm">
            {task ? "Save" : "Create task"}
          </button>
          {task && (
            <button type="button" onClick={archive} disabled={isPending} className="btn-ghost btn-sm ml-auto text-danger">
              Archive
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function AddColumn({ orgId, onError }: { orgId: string; onError: (error: string | null) => void }) {
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="btn-ghost h-fit w-56 shrink-0 justify-start border border-dashed border-border"
      >
        + Add column
      </button>
    );
  }

  return (
    <form
      className="card-inset flex h-fit w-56 shrink-0 flex-col gap-2 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onError(null);
        startTransition(async () => {
          const result = await addColumn(orgId, name);
          if (result.ok) {
            setName("");
            setAdding(false);
          } else onError(result.error);
        });
      }}
    >
      <input
        autoFocus
        aria-label="New column name"
        placeholder="Column name"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={isPending}
        className="field field-sm"
      />
      <div className="flex gap-1.5">
        <button type="submit" disabled={isPending} className="btn-primary btn-xs">
          Add
        </button>
        <button type="button" onClick={() => setAdding(false)} className="btn-ghost btn-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
