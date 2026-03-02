# Third-Party Notices — chat-microservices-frontend

This project is licensed under the MIT License.  
See [LICENSE](./LICENSE) for the full license text.

This file documents all third-party open-source packages used in this frontend
that require attribution or special notice, particularly those with copyleft terms.

---

## License Compliance Scan Summary

| Scan Date | Issues Found | Status |
|---|---|---|
| 2026-03-02 | 1 — GPL-3.0 (see §1) | ✅ Documented |

---

## §1 — GPL-3.0 Dependency

### `@privacyresearch/libsignal-protocol-typescript@0.0.16`

- **License:** GPL-3.0-only
- **Copyright:** Copyright 2020 by Privacy Research, LLC
- **Repository:** https://github.com/privacyresearchgroup/libsignal-protocol-typescript
- **Used for:** Client-side E2EE — Signal Protocol (X3DH + Double Ratchet) implementation

**Notice:**  
This library is licensed under the GNU General Public License v3.0 (GPL-3.0-only).
The GPL-3.0 is a strong copyleft license. Its terms apply to all distribution of
software that incorporates or links with this library.

The full GPL-3.0 license text is available at:  
https://www.gnu.org/licenses/gpl-3.0.html

**Compliance statement:**  
This frontend application distributes `@privacyresearch/libsignal-protocol-typescript`
to users' browsers as part of the JavaScript bundle, which constitutes "conveying"
under GPL-3.0 §0 (confirmed by the FSF GPL FAQ on web-served JavaScript). Compliance
is achieved under GPL-3.0 §6(d): the complete corresponding source code is publicly
available at this repository, accessible via the network.

Any person who distributes, modifies, or builds upon this project must do so in
compliance with the GPL-3.0 license terms, including making the corresponding
source code available.

All other frontend source code is MIT-licensed. The MIT license is GPL-compatible
(confirmed by the FSF License List); MIT-licensed components may lawfully be
incorporated into a GPL-3.0 distribution. Recipients of the bundled application
receive it subject to GPL-3.0 terms.

---

## §2 — All Other Third-Party Packages

All remaining production dependencies use fully permissive licenses compatible
with the MIT license of this project.

| License | Count |
|---|---|
| MIT | 1 |

No AGPL, LGPL, SSPL, CC-BY-SA, or other copyleft licenses were detected beyond §1.

---

## Regenerating This Scan

```bash
# Run from this directory (chat-microservices-frontend/)
npx license-checker --production --summary
npx license-checker --production --json > licenses.json
```
