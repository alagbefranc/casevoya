/**
 * The Lead pipeline and lead pages assembled from their loaders, for body.tsx. The page parts are
 * the Designer ports in designer/pipeline.tsx and designer/lead.tsx; the live-only parts are
 * listed there.
 */
import { Icon, SheetFrame } from "@/components/sheet/designer/frame";
import {
  ConflictDialog,
  ConflictPanel,
  ConsultationsPanel,
  ConvertDialog,
  DlPanel,
  DuplicateCompareDialog,
  EditLeadDialog,
  FollowUpDialog,
  HistoryPanel,
  LeadHeader,
  LostDialog,
  SheetLead,
} from "@/components/sheet/designer/lead";
import { BookingLeadsDialog, CsvDialog, NewLeadDialog, PipelineHeader, SheetPipeline } from "@/components/sheet/designer/pipeline";
import type { LeadPage, PipelinePage } from "@/modules/leads/load";

export function PipelineScreen({ loaded }: { loaded: PipelinePage }) {
  return (
    <SheetFrame
      sidebar={loaded.chrome.sidebar}
      header={<PipelineHeader data={loaded.header} />}
      statusbar={loaded.chrome.statusbar}
      title={"Lead pipeline"}
      trailing={
        <>
          <CsvDialog
            data={{
              ...loaded.csv,
              input: <input type={"file"} id={"csvIn"} accept={".csv,text/csv"} hidden aria-describedby={"csvF-h"} />,
            }}
          />
          <NewLeadDialog data={loaded.newLead} />
          {loaded.bookings ? <BookingLeadsDialog data={loaded.bookings} /> : null}
        </>
      }
    >
      <SheetPipeline data={loaded.page} />
    </SheetFrame>
  );
}

export function LeadScreen({ loaded }: { loaded: LeadPage }) {
  const { dialogs } = loaded;
  return (
    <SheetFrame
      sidebar={loaded.chrome.sidebar}
      header={
        <LeadHeader
          data={{
            ...loaded.header,
            extra: (
              <>
                {dialogs.edit ? (
                  <button className={"btn s sm"} type={"button"} data-lead-open={"edit"}>
                    <Icon name={"edit"} cls={"ic s"} />
                    {"Edit"}
                  </button>
                ) : null}
                {dialogs.lost ? (
                  <button className={"btn s sm"} type={"button"} data-lead-open={"lost"}>
                    {"Close as lost"}
                  </button>
                ) : null}
              </>
            ),
          }}
        />
      }
      statusbar={loaded.chrome.statusbar}
      after={
        <>
          {dialogs.convert ? <ConvertDialog data={dialogs.convert} /> : null}
          {dialogs.duplicate ? <DuplicateCompareDialog data={dialogs.duplicate} /> : null}
          {dialogs.lost ? <LostDialog data={dialogs.lost} /> : null}
          {dialogs.edit ? <EditLeadDialog data={dialogs.edit} /> : null}
          <FollowUpDialog data={dialogs.followUp} />
          {dialogs.conflict && loaded.conflictMatches ? <ConflictDialog data={{ data: dialogs.conflict, matches: loaded.conflictMatches }} /> : null}
        </>
      }
    >
      <SheetLead
        data={{
          ...loaded.page,
          leftAfter: (
            <>
              <ConflictPanel data={loaded.conflict} />
              <ConsultationsPanel rows={loaded.consultations.rows} link={loaded.consultations.link} />
              <HistoryPanel items={loaded.history} />
            </>
          ),
          rightAfter: <DlPanel icon={"inbox"} title={"Enquiry"} items={loaded.enquiry} />,
        }}
      />
    </SheetFrame>
  );
}
