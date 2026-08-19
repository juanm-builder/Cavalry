# Third-party notices

Cavalry project code is licensed under the [Apache License 2.0](LICENSE). This file identifies important third-party software and artwork distributed with or referenced by Cavalry. It is informational and does not replace the original license texts.

## Desktop runtime

The packaged desktop application uses the following principal projects:

| Project                                              | License                               | Source                                                                          |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Tauri and Wry                                        | Apache-2.0 and MIT                    | [tauri-apps/tauri](https://github.com/tauri-apps/tauri)                         |
| Tauri official plugins                               | Apache-2.0 and MIT                    | [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) |
| Rust standard library and Cargo-resolved crates      | Project-specific open-source licenses | [Rust](https://github.com/rust-lang/rust) and each crate's package metadata     |
| Node.js runtime embedded in the Cavalry host sidecar | MIT and bundled third-party notices   | [nodejs/node](https://github.com/nodejs/node)                                   |
| React and React DOM                                  | MIT                                   | [facebook/react](https://github.com/facebook/react)                             |
| Supabase JavaScript client                           | MIT                                   | [supabase/supabase-js](https://github.com/supabase/supabase-js)                 |
| `@yao-pkg/pkg` build tool                            | MIT                                   | [yao-pkg/pkg](https://github.com/yao-pkg/pkg)                                   |

On macOS, Tauri uses the operating system's WKWebView. On Windows, it uses the installed Microsoft Edge WebView2 runtime. Cavalry does not distribute an Electron or Chromium framework. System WebView components remain governed by their platform terms.

Exact JavaScript versions and transitive dependencies are recorded in `package-lock.json`. Exact Rust versions must be recorded in `apps/desktop/src-tauri/Cargo.lock` before a production release. The target-specific Node sidecar must retain Node's bundled license and third-party notices.

Packaged applications include or link to:

- `LICENSE`
- `THIRD_PARTY_NOTICES.md`
- `apps/desktop/packaging/RUNTIME-DEPENDENCY-INVENTORY.txt`
- the license and notice material emitted with the target-specific Node sidecar

`RUNTIME-DEPENDENCY-INVENTORY.txt` is generated from `package-lock.json` by `tools/release/generate-runtime-licenses.mjs`. It provides a reviewable inventory for the JavaScript production graph. Production packaging must also verify that Rust crate and embedded Node notices are present in the final bundle.

## Material Symbols

The renderer currently requests the Material Symbols font stylesheet from Google Fonts at runtime. Material Symbols are part of Google's [Material Design Icons](https://github.com/google/material-design-icons) project and are licensed under Apache-2.0. The font is not stored as a source asset in this repository.

## Optional local-model tooling

Cavalry can launch or connect to [llama.cpp](https://github.com/ggml-org/llama.cpp), which is licensed under MIT. The repository does not bundle the llama.cpp executable or model weights. Any GGUF model selected or downloaded by a user remains subject to its model author's separate license and acceptable-use terms.

## Institution logos

The SVG files under `apps/desktop/src/renderer/assets/institution-logos/` are local copies from Wikimedia Commons used only to identify institutions in the user interface. They were imported without modification. The source pages provide the following authorship and licensing information:

| File               | Attribution                                                                                       | Copyright license or status                                                                                                                      | Wikimedia Commons source                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `aub.svg`          | Asia United Bank; consortium of Jacinto Ng et al. and China United Trust & Investment Corporation | Public domain text/logo, as stated by Commons                                                                                                    | [Asia United Bank logo](https://commons.wikimedia.org/wiki/File:Asia_United_Bank_logo.svg)                                  |
| `bdo.svg`          | Banco de Oro                                                                                      | Public domain text/logo, as stated by Commons                                                                                                    | [BDO Unibank logo](<https://commons.wikimedia.org/wiki/File:BDO_Unibank_(logo).svg>)                                        |
| `bpi.svg`          | Bank of the Philippine Islands                                                                    | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); no project modifications                                                              | [Official BPI logo](https://commons.wikimedia.org/wiki/File:Official_BPI_Logo.svg)                                          |
| `chinabank.svg`    | Chinabank                                                                                         | Public domain text/logo, as stated by Commons                                                                                                    | [Chinabank 2024 logo](https://commons.wikimedia.org/wiki/File:Chinabank_2024.svg)                                           |
| `cimb.svg`         | CIMB Group                                                                                        | Public domain text/logo, as stated by Commons                                                                                                    | [CIMB Group logo](https://commons.wikimedia.org/wiki/File:CIMB_Group_Logo.svg)                                              |
| `eastwest.svg`     | EastWest Bank; vector by Wikimedia Commons user Moonrivers                                        | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) for the vectorization; Commons also marks the underlying text/logo public domain | [EastWest Bank logo](https://commons.wikimedia.org/wiki/File:EastWest_Bank_2011_h-pos_logo.svg)                             |
| `gcash.svg`        | Wikimedia Commons user Moonrivers, based on an original uploaded by Hariboneagle927               | Public domain text/logo, as stated by Commons                                                                                                    | [GCash logo](https://commons.wikimedia.org/wiki/File:GCash_logo.svg)                                                        |
| `gotyme.svg`       | JG Summit Holdings / GoTyme Bank                                                                  | Public domain text/logo, as stated by Commons                                                                                                    | [GoTyme Bank logo](https://commons.wikimedia.org/wiki/File:GoTyme_Bank_logo.svg)                                            |
| `hsbc.svg`         | HSBC                                                                                              | Public domain text/logo, as stated by Commons                                                                                                    | [HSBC 2018 logo](<https://commons.wikimedia.org/wiki/File:HSBC_logo_(2018).svg>)                                            |
| `landbank.svg`     | Land Bank of the Philippines                                                                      | Public domain text/logo, as stated by Commons                                                                                                    | [LANDBANK logo](https://commons.wikimedia.org/wiki/File:Landbank.svg)                                                       |
| `maya.svg`         | Maya Bank, Inc. and PayMaya Philippines, Inc.                                                     | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); no project modifications                                                              | [Maya logo](https://commons.wikimedia.org/wiki/File:Maya_logo.svg)                                                          |
| `metrobank.svg`    | Author listed as unknown on Commons                                                               | Public domain text/logo, as stated by Commons                                                                                                    | [Metropolitan Bank and Trust Company logo](https://commons.wikimedia.org/wiki/File:Metropolitan_Bank_and_Trust_Company.svg) |
| `pnb.svg`          | Wikimedia Commons user Moonrivers, based on the Philippine National Bank logo                     | Public domain text/logo, as stated by Commons                                                                                                    | [Philippine National Bank logo](https://commons.wikimedia.org/wiki/File:Philippine-National-Bank-logo.svg)                  |
| `rcbc.svg`         | Rizal Commercial Banking Corporation                                                              | Public domain text/logo, as stated by Commons                                                                                                    | [RCBC logo](https://commons.wikimedia.org/wiki/File:RCBC_logo.svg)                                                          |
| `securitybank.svg` | Philippine Asset Management Corporation; vector by Wikimedia Commons user Maja Ruth               | Public domain text/logo, as stated by Commons                                                                                                    | [Security Bank logo](https://commons.wikimedia.org/wiki/File:Security_Bank_logo.svg)                                        |
| `unionbank.svg`    | UnionBank Philippines; vector by Wikimedia Commons user Moonrivers                                | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) for the vectorization; Commons also marks the underlying text/logo public domain | [UnionBank Philippines logo](https://commons.wikimedia.org/wiki/File:UnionBank_PH_logo.svg)                                 |

The Creative Commons attributions above identify the material, credited creator, source, license, and the fact that Cavalry did not modify the imported SVG.

Institution names and logos may be protected by trademark law even where a source page identifies the artwork as public domain for copyright purposes. All institution names and trademarks remain the property of their respective owners. Their inclusion does not imply endorsement, sponsorship, or affiliation, and no trademark rights are granted by Cavalry's Apache-2.0 license.

## Cavalry branding and conduct policy

The Cavalry name, application icon, and assistant artwork are project branding. Source-image provenance metadata identifies OpenAI's image-generation tooling for portions of that artwork. Apache-2.0 does not grant permission to use Cavalry or third-party names, logos, or marks in a way that suggests endorsement.

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) is informed by Contributor Covenant 2.1, which is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
