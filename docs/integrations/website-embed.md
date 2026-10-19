# Your enquiry form: link, QR code and website embed

Every firm on Casevoya has a public enquiry form. A prospective client fills it in and the
enquiry arrives as a lead in **New** on **Leads › Pipeline**, with the consent they gave.

Find everything below in the Sheet: **Leads › Pipeline › Share enquiry form** (also on
**Practice › Intake forms**). The dialog shows your firm's own link and snippets, ready to copy.

## Before you share it

- **Publish your privacy notice** (Settings › Client portal). Until you do, the form says
  "This form isn't available" and takes no enquiries.
- **Sample mode:** while your firm is in sample mode the form is a practice page. Only your own
  team, signed in with two-step, can open it, and anything sent is a sample lead. Visitors get
  "not found" until your firm is verified.

## 1. Share the link

Your form lives at:

```
https://app.casevoya.ca/enquiry/<your-firm>
```

Send it by email, put it in your email signature or social profiles, or print the **QR code**
from the dialog (Download QR code) on a flyer or business card. Enquiries from the link are
recorded with the source "Hosted page".

## 2. Put the form on your website (recommended)

Paste this where the form should appear on your page (most website builders have an "HTML" or
"Embed code" block):

```html
<div data-casevoya-enquiry="<your-firm>"></div>
<script async src="https://app.casevoya.ca/embed/enquiry.js"></script>
```

The script adds the form and keeps its height matched to the form, so there is no inner
scroll bar. It has no other dependencies and sets no cookies on your site. You can put the
`<script>` line once near the end of the page if you prefer.

## 3. Or use a plain iframe

If your builder accepts only an iframe:

```html
<iframe src="https://app.casevoya.ca/embed/enquiry/<your-firm>" title="Enquiry form" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>
```

An iframe can't resize itself, so give it enough height for the form (about 900px on a phone).

Enquiries from your website (either way) are recorded with the source "Website form".

## What the form asks

Name, email or phone, preferred contact, what they need help with, the country they live in and
the language they'd like you to use. It never asks for passport details or documents. There are
two separate boxes: one, required, lets your firm reply to the enquiry; the other, optional, is
for your firm's news. Both are stored with the exact wording the visitor saw and the time.

## Spam protection

A hidden field that people never fill, a short form timer, and limits per address and per firm.

## Technical notes (for your web developer)

- Only `/embed/enquiry/<your-firm>` may be shown inside another site's frame
  (`Content-Security-Policy: frame-ancestors *`). Every other Casevoya page refuses to be framed.
- The embedded form posts `{ type: "casevoya:enquiry:height", height }` to the parent window. The
  script accepts it only from `https://app.casevoya.ca` and only from the iframe it created.
- The script finds every `[data-casevoya-enquiry]` element present when it runs. If your site adds
  the element later (a single-page app), call `window.__casevoyaEnquiry.mount()` after adding it.
