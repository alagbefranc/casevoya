-- More per-staff Composio toolkits: Zoom, Google Meet, Microsoft Teams, Dropbox and Calendly.
-- Same table, policy, RPCs and callback as Gmail/Outlook/Google Calendar. They are linked only:
-- composio-policy.ts blocks every tool of these toolkits, so nothing is read or written yet.
alter table public.staff_connections drop constraint if exists staff_connections_toolkit_check;
alter table public.staff_connections
  add constraint staff_connections_toolkit_check check (toolkit in (
    'gmail', 'outlook', 'googlecalendar', 'outlook_calendar',
    'zoom', 'googlemeet', 'microsoft_teams', 'dropbox', 'calendly'
  ));
