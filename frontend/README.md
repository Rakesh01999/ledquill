# LedQuill web app

Next.js 16 (App Router), TypeScript, Tailwind 4, shadcn/ui, TanStack Query.

## Run

```bash
cd frontend
cp .env.example .env.local     # then set LEDQUILL_API_KEY (server-side only)
npm install
npm run dev                    # http://localhost:3000
npm run lint && npm run typecheck && npm run build
```

`LEDQUILL_API_URL` and `LEDQUILL_API_KEY` are read on the server only. The browser calls this
app's `/api/v1/*` route handler, which adds the `X-API-Key` header. Never prefix either variable
with `NEXT_PUBLIC_`.

## API types

`openapi.json` is exported from the FastAPI app and `lib/api/schema.d.ts` is generated from it:

```bash
npm run export:api   # needs the docker stack up
npm run gen:api
```

Regenerate both after any API change. Types in `lib/api/types.ts` are aliases of the generated ones.

## Keyboard

`/` focus search, `J` and `K` next and previous invoice in the review queue, `A` approve,
`E` edit the focused field. Shortcuts are ignored while typing and while a dialog is open.

## Known limitations

- **No Confirm action for low-confidence fields.** A reviewer can edit a value, but cannot mark an
  unchanged low-confidence value as checked. Saving the same value sends nothing.
- **Line items are read-only.** The API can replace line items, but the UI has no editor for them.
- **Upload limits are fixed text.** "25 MB per file, 20 files per upload" is written in the UI. The
  API does not expose its limits, so changing them in the backend settings does not change this copy.
- **Search mode is always hybrid.** There is no keyword or semantic toggle. A query combined with any
  filter uses keyword matching and paginates; a query alone uses ranked hybrid search, no pages.
- **No field highlight on the source page.** The source panel shows the page image and its text, and a
  field's page chip switches the page, but nothing marks where the value sits.
- **No download of the original file, no Reject action, no due date or PO number fields.** The API
  has no endpoint or field for them.
- **Queue position counts the first 100 open invoices only.**
- **Documents are listed newest first** and cannot be sorted by column.
