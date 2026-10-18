/**
 * The "Edit details" dialog for one person: name, email, phone and date of birth.
 * The Designer has no edit-person dialog, so this is its `.dlg` with the `.fld` / `.inp`
 * fields of the New matter dialog (`Field`, from the Designer's "Convert to a matter").
 * One dialog per page; the button that opens it carries the person's details as `data-*`
 * (`personEditProps`) and the kit fills the fields from them (`person-edit-act.ts`).
 */
import { Icon } from "./frame";
import { Field } from "./matters";
import { birthHint, type PersonEditData } from "@/modules/sheet/edit-person";

export const PERSON_EDIT_DIALOG = "dlgPE";

export type PersonEditDialogData = {
  /** The latest date of birth the field accepts (`YYYY-MM-DD`). */
  maxBirthDate: string;
  /** The matter page: the footer offers "Invite to the portal" for someone who can be invited. */
  invite?: boolean;
};

/** The opener's `data-*`: which person, and what the fields start with. */
export function personEditProps(data: PersonEditData) {
  return {
    "data-edit-open": "1",
    "data-org": data.organizationId,
    "data-person": data.personId,
    "data-version": String(data.version),
    "data-name": data.name,
    "data-email": data.email,
    "data-phone": data.phone,
    "data-birth": data.dateOfBirth,
    "data-birth-hint": birthHint(data),
  };
}

export function PersonEditDialog({ data }: { data: PersonEditDialogData }) {
  return (
    <dialog className={"dlg"} id={PERSON_EDIT_DIALOG} aria-labelledby={"dlgPEH"}>
      <div className={"dh"}>
        <h2 id={"dlgPEH"}>{"Edit details"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={PERSON_EDIT_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{"Changes are saved on their record and kept in the firm’s audit log."}</p>
        <Field id={"peN"} label={"Name"} />
        <Field id={"peE"} label={"Email"} hint={"Optional. Used for invitations and reminders."} type={"email"} />
        <Field id={"peP"} label={"Phone"} hint={"Optional. With the country code, like +1 416 555 0100."} type={"tel"} />
        <Field id={"peD"} label={"Date of birth"} hint={"Optional. Only adults get a portal login."} type={"date"} max={data.maxBirthDate} />
      </div>
      <div className={"df"}>
        {data.invite ? (
          <button className={"btn"} data-edit-invite={"1"} hidden>
            {"Invite to the portal"}
          </button>
        ) : null}
        <button className={"btn"} data-close={PERSON_EDIT_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-person-save={"1"}>
          {"Save details"}
        </button>
      </div>
    </dialog>
  );
}
