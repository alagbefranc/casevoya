/**
 * The Designer's Sheet sidebar (site/app-v2 sheet, `aside.side`), rendered from data.
 * Same DOM, classes and order as the captured markup in `markup/index.tsx`; only the
 * counts, pinned matters, profile and destinations come from the firm's records.
 */
import type { ReactNode } from "react";

const SPRITE = "/assets/icons-coreui/sprite.svg";

export type SidebarPerson = { name: string; avatarUrl?: string | null };

export type SidebarData = {
  /** href of the item to mark `on`. */
  active: string;
  counts: {
    notifications?: number;
    drafts?: number;
    tasks?: number;
    inbox?: number;
    finance?: number;
    pipeline?: number;
    sourcesReview?: number;
  };
  pinned: (SidebarPerson & { href: string })[];
  me: SidebarPerson & { role: string };
  tiles: { documents: string; invoices: string };
  newMatter: Action;
  createBoard: Action;
};

type Action = { href: string; toast?: string; toastSub?: string };

/** First letters of the first and last words that contain a letter ("Sample permit (E2E)" → "SE"). */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/\p{L}/u)?.[0])
    .filter((letter): letter is string => Boolean(letter));
  if (letters.length === 0) return "?";
  return (letters[0] + (letters.length > 1 ? letters[letters.length - 1] : "")).toUpperCase();
}

/** The Designer's `.av` circle: a photo when there is one, otherwise initials in the same circle. */
export function Avatar({ person, cls = "av" }: { person: SidebarPerson; cls?: string }) {
  if (person.avatarUrl) return <img className={cls} src={person.avatarUrl} alt={""} />;
  return (
    <span className={cls} aria-hidden={"true"}>
      {initials(person.name)}
    </span>
  );
}

function Icon({ name, size }: { name: string; size?: "s" }) {
  return (
    <svg className={size ? `ic ${size}` : "ic"} aria-hidden={"true"}>
      <use href={`${SPRITE}#i-${name}`} />
    </svg>
  );
}

function Count({ value, label, blue }: { value?: number; label?: string; blue?: boolean }) {
  if (!value) return null;
  if (label) {
    return (
      <span className={blue ? "k b" : "k"} aria-label={label}>
        {String(value)}
      </span>
    );
  }
  return <span className={blue ? "k b" : "k"}>{String(value)}</span>;
}

function Item({ href, icon, label, active, children }: { href: string; icon: string; label: string; active: string; children?: ReactNode }) {
  return (
    <a href={href} className={href === active ? "on" : ""}>
      <Icon name={icon} />
      <span>{label}</span>
      {children}
    </a>
  );
}

function AddLink({ action, label }: { action: Action; label: string }) {
  return (
    <a className={"add"} href={action.href} data-toast={action.toast} data-toast-sub={action.toastSub}>
      <Icon name={"plus"} size={"s"} />
      <span>{label}</span>
    </a>
  );
}

function Group({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className={"grp"}>
      <button aria-expanded={"true"}>
        <Icon name={icon} />
        <span>{label}</span>
        <svg className={"ic s ch"} aria-hidden={"true"}>
          <use href={`${SPRITE}#i-chevron-down`} />
        </svg>
      </button>
      <div className={"tree"}>{children}</div>
    </div>
  );
}

function Tile({ href, background, label, icon, kbd }: { href: string; background: string; label: string; icon: string; kbd: string }) {
  return (
    <a className={"tile k2-wt-t"} href={href} style={{ background }} aria-label={label} data-wt={"1"}>
      <Icon name={icon} />
      <span className={"tip"}>
        {label}
        <kbd>{kbd}</kbd>
      </span>
    </a>
  );
}

export function SheetSidebar({ data }: { data: SidebarData }) {
  const { active, counts } = data;
  return (
    <aside className={"side"} id={"side"} aria-label={"Main"}>
      <div className={"brand"}>
        <a href={"/sheet"}>
          <img src={"/assets/brand/casevoya-wordmark-white.svg"} alt={"Casevoya"} width={126} height={20} />
        </a>
        <button id={"mClose"} aria-label={"Close menu"} style={{ color: "#8b8680" }}>
          <Icon name={"close"} />
        </button>
      </div>
      <div className={"tiles k2-wtg"}>
        <Tile href={"/sheet/intake-builder"} background={"#0075DE"} label={"Intake"} icon={"file-check"} kbd={"I"} />
        <Tile href={data.tiles.documents} background={"#2f6db3"} label={"Documents"} icon={"folder"} kbd={"D"} />
        <Tile href={"/sheet/calendar"} background={"#3a3a3a"} label={"Calendar"} icon={"calendar"} kbd={"C"} />
        <Tile href={data.tiles.invoices} background={"#484848"} label={"Invoices"} icon={"invoice"} kbd={"B"} />
        <Tile href={"/sheet/drafts"} background={"#0a4b93"} label={"Vo drafts"} icon={"sparkles"} kbd={"V"} />
      </div>
      <nav className={"nav"}>
        <a href={"/sheet"} className={active === "/sheet" ? "on" : ""}>
          <Icon name={"home"} />
          <span>{"Home"}</span>
        </a>
        <a href={"#"} data-palette={"1"}>
          <Icon name={"search"} />
          <span>{"Search…"}</span>
          <span className={"k"} aria-label={"Command K"}>
            <svg
              className={"cmdk"}
              viewBox={"0 0 24 24"}
              aria-hidden={"true"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"1.8"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
            >
              <path d={"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"} />
            </svg>
            {"K"}
          </span>
        </a>
        <Item href={"/sheet/notifications"} icon={"bell"} label={"Notifications"} active={active}>
          <Count value={counts.notifications} />
        </Item>
        <Item href={"/sheet/drafts"} icon={"sparkles"} label={"Vo drafts"} active={active}>
          <Count value={counts.drafts} blue />
        </Item>
      </nav>
      <Group icon={"folder"} label={"Work"}>
        <Item href={"/sheet/matters"} icon={"menu"} label={"All matters"} active={active} />
        {data.pinned.map((matter) => (
          <a key={matter.href} href={matter.href} className={matter.href === active ? "on" : ""}>
            <Avatar person={matter} />
            <span>{matter.name}</span>
          </a>
        ))}
        <Item href={"/sheet/clients"} icon={"users"} label={"Clients"} active={active} />
        <Item href={"/sheet/tasks"} icon={"task"} label={"Tasks"} active={active}>
          <Count value={counts.tasks} />
        </Item>
        <Item href={"/sheet/government"} icon={"globe"} label={"Government status"} active={active} />
        <AddLink action={data.newMatter} label={"New matter"} />
      </Group>
      <Group icon={"inbox"} label={"Records"}>
        <Item href={"/sheet/inbox"} icon={"inbox"} label={"Inbox"} active={active}>
          <Count value={counts.inbox} />
        </Item>
        <Item href={"/sheet/documents"} icon={"folder"} label={"Documents"} active={active} />
        <Item href={"/sheet/agreements"} icon={"signature"} label={"Agreements"} active={active} />
        <Item href={"/sheet/finance"} icon={"wallet"} label={"Finance"} active={active}>
          <Count value={counts.finance} />
        </Item>
      </Group>
      <Group icon={"users"} label={"Leads"}>
        <Item href={"/sheet/pipeline"} icon={"kanban"} label={"Pipeline"} active={active}>
          <Count value={counts.pipeline} />
        </Item>
        <Item href={"/sheet/consultations"} icon={"calendar"} label={"Consultations"} active={active} />
        <Item href={"/sheet/calendar"} icon={"calendar"} label={"Calendar"} active={active} />
      </Group>
      <Group icon={"dashboard"} label={"Boards"}>
        <Item href={"/sheet/queue"} icon={"users"} label={"Team queue"} active={active} />
        <Item href={"/sheet/matters?view=due"} icon={"flag"} label={"Due this week"} active={active} />
        <Item href={"/sheet/matters?view=review"} icon={"eye"} label={"Awaiting my review"} active={active} />
        <AddLink action={data.createBoard} label={"Create board"} />
      </Group>
      <Group icon={"settings"} label={"Practice"}>
        <Item href={"/sheet/reports"} icon={"reports"} label={"Reports"} active={active} />
        <Item href={"/sheet/templates"} icon={"templates"} label={"Templates"} active={active}>
          <Count
            value={counts.sourcesReview}
            blue
            label={counts.sourcesReview ? `${counts.sourcesReview} ${counts.sourcesReview === 1 ? "source needs" : "sources need"} review` : undefined}
          />
        </Item>
        <Item href={"/sheet/ai"} icon={"sparkles"} label={"Vo and AI"} active={active} />
        <Item href={"/sheet/automations"} icon={"lightning"} label={"Automations"} active={active} />
        <Item href={"/sheet/intake-builder"} icon={"file"} label={"Intake forms"} active={active} />
        <Item href={"/sheet/invitations"} icon={"user-plus"} label={"People and invitations"} active={active} />
        <Item href={"/sheet/licence"} icon={"id-card"} label={"Licences"} active={active} />
        <Item href={"/sheet/roles"} icon={"shield"} label={"Roles and permissions"} active={active} />
        <Item href={"/sheet/grants"} icon={"key"} label={"Access grants"} active={active} />
        <Item href={"/sheet/settings"} icon={"settings"} label={"Settings"} active={active} />
      </Group>
      <Group icon={"privacy"} label={"Compliance"}>
        <Item href={"/sheet/complaints"} icon={"flag"} label={"Complaints"} active={active} />
        <Item href={"/sheet/privacy"} icon={"privacy"} label={"Privacy requests"} active={active} />
        <Item href={"/sheet/exports"} icon={"download"} label={"Client-file exports"} active={active} />
        <Item href={"/sheet/migration"} icon={"import"} label={"Migration import"} active={active} />
        <Item href={"/sheet/states"} icon={"grid"} label={"System states"} active={active} />
      </Group>
      <div className={"me"}>
        <Avatar person={data.me} />
        <div>
          {data.me.name}
          <small>{data.me.role}</small>
        </div>
      </div>
    </aside>
  );
}
