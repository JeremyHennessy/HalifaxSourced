# Structured phone display retention — 25 October 2026

This code-only review preserves readable existing contact numbers when an older
structured extraction contains HTML entities, URI escapes or stray URL syntax.
It does not newly verify a phone number, decode a source into a new fact, or
change any raw source record, observation date, identity or media approval.

The accepted browser script order previously replaced the following contact
numbers with malformed structured observations. The new display guard retains
the existing contact field instead:

| Restaurant | Malformed observation (retained as raw evidence) | Existing contact retained |
| --- | --- | --- |
| Sketti and Ball | `&#43;&#49;90&#50;4&#52;4&#48;&#50;77` | `+1 902-444-0277` |
| Gingerbread Haus Bakery | `//+1 (902) 425-4333` | `+1-902-425-4333` |
| The BG | `+&#49;9&#48;&#50;4&#48;5&#52;55&#52;` | `+1-902-405-4554` |
| PG Cafe and Grill | `%20+1(902)429-8806` | `+1-902-429-8806` |
| Mother's Pizza | `+1%20902-406-5050` | `+19024065050` |

These are retained contacts, not newly confirmed current owner facts. All five
malformed observations retain their original September 4 source clocks and their
`structuredPhone`/`structuredFacts.phone` values. Exact reviewed corrections and
explicit null holds still take final precedence.

## Boundary and risks

The guard accepts readable numeric telephone formatting with 7–15 base digits,
balanced nonnested parentheses, an optional leading plus, common spacing/dashes,
and optional numeric `ext`, `extension`, `x` or `#` extensions up to six digits.
It does not prove dialability, ownership, locality or freshness. It intentionally
does not decode HTML/URI text or strip source labels. Unrecognized forms such as
vanity numbers, explicitly separated/labelled multiple numbers, unusual extensions
or dialing-control syntax are held rather than guessed; plausible numeric debris
or space-separated numbers can still pass this lexical check. A readable existing contact is retained,
or the contact remains unknown when none existed. Explicit reviewed facts remain
authoritative and are outside this automatic extraction guard.

## Regression evidence

`node scripts/test-structured-phone-projection.mjs` tests local and international
formats, extensions, malformed encodings, missing contacts, explicit reviewed
changes and null holds. It compares the full actual browser consumer order with
the former unconditional phone projection at a fixed test clock. On base
`3120f54af33e603b7f03c220f66420b6c311ce54`, exactly the five phone projections
above change; all other fields and 649 other restaurant projections are identical.
The complete raw structured payload is unchanged. The regression runs in Quality
Gate alongside the existing civic-address retention regression.

No collection, access-policy change, raw data refresh, menu/offer promotion,
source-link upgrade, CSS/navigation change or thumbnail approval is included.
