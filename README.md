# LexAnon EN

A Chrome extension for **local anonymization of personal data** in `.docx` files.  
Files are processed entirely in the browser — no data is ever sent to any server.

---

## Features

- **Fully offline** — no servers, no cloud uploads
- **Document language:** English (with multilingual support)
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
| Full Name | Mr. John Smith, Dr. Emily Johnson |
| Company | Acme Corp. LLC, GlobalTech Inc., Smith & Partners LLP |
| Tax ID / EIN | 12-3456789 |
| SSN (US) | 123-45-6789 |
| SWIFT | BARCGB22 |
| IBAN | GB29NWBK60161331926819 |
| Bank Account | account numbers in standard formats |
| Email | john.smith@example.com |
| Phone | +1 (555) 123-4567, +44 20 7946 0958 |
| URL | https://example.com |
| Address | 123 Main St, New York, NY 10001; 10 Downing St, London SW1A 2AA |
| Contract No. *(off)* | No. 123/AB-2024 |
| Amounts *(off)* | $150,000.00, £85,000, €200,000 |

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
│   ├── validators.js     # Checksum validation (SSN, IBAN, EIN, etc.)
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
