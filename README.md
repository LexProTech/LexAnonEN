# LexAnon EN

A Chrome extension for **local anonymization of personal data** in `.docx` files.  
Files are processed entirely in the browser — no data is ever sent to any server.

---

## Features

- **Fully offline** — no servers, no cloud uploads
- **Document language:** English, Russian, or both
- **17 entity categories** — from names to IBAN
- **3 replacement modes:** placeholders (`NAME_1`), masking (`████`), deletion
- **Exception dictionary** — words and phrases that won't be replaced
- **Custom categories** — define your own regular expressions
- **Mapping export** — JSON table of "original → replacement"
- **Auto-intercept** — anonymization panel appears when any `.docx` is selected on any website
- **Two download options:** anonymized file or file with color-highlighted entities

---

## Detected Data

| Category | Examples |
|---|---|
| ФИО / Name | Mr. John Smith, Jane Doe |
| Company | Acme Corp. LLC, ООО «Ромашка» |
| ИНН | 7707083893 |
| КПП | 770701001 |
| ОГРН / ОГРНИП | 1027700132195 |
| БИК | 044525225 |
| Bank Account | 40702810000000000001 |
| SSN (US) | 123-45-6789 |
| Tax ID / EIN | 12-3456789 |
| SWIFT | SABRRUMM |
| IBAN | DE89370400440532013000 |
| Email | john@example.com |
| Phone | +1 (555) 123-4567 |
| URL | https://example.com |
| Address | 123 Main St, New York, NY 10001 |
| Contract No. *(off)* | No. 123/AB-2024 |
| Amounts *(off)* | $150,000.00 |

---

## Installation

1. Download or clone the repository:
   ```bash
   git clone https://github.com/LexProTech/LexAnonEN.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right corner)
4. Click **Load unpacked** and select the repository folder

---

## Usage

1. Click the LexAnon EN icon in the Chrome toolbar
2. Drag and drop a `.docx` file or click to select one
3. Configure categories, replacement mode and document language
4. Review detected entities, uncheck any you want to keep
5. Click **Anonymize & Download**

---

## Project Structure

```
├── manifest.json         # Extension manifest (MV3)
├── background.js         # Service Worker
├── content/
│   └── content.js        # Auto-intercept script
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js          # UI logic
├── lib/
│   ├── entity-finder.js  # Entity detection (regex + rules)
│   ├── validators.js     # INN, OGRN, BIK validation
│   ├── replacer.js       # Text replacement
│   └── docx-parser.js    # .docx parsing and rebuilding
├── worker/
│   └── processor.js      # Web Worker for heavy processing
├── vendor/
│   └── jszip.min.js      # ZIP handling (.docx base)
└── icons/
```

---

## License

MIT — see [LICENSE](LICENSE)
