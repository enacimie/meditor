//! Printing to PDF through the DevTools protocol, on Windows.
//!
//! WebView2's `PrintToPdf` has no setting for an outline, a structure tree or
//! the document's language, and measured on 2026-09-25 its PDFs carried none
//! of the three. `Page.printToPDF`, asked for through
//! `CallDevToolsProtocolMethod`, writes all three when told to: the headings
//! become the PDF's bookmarks. It answers with the PDF in base64 rather than
//! writing a file, so this is the half of that exchange that needs no
//! webview — the question, and the reading of the answer — where it can be
//! tested.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Deserialize;
use std::borrow::Cow;

/// The parameters `export_pdf` sends with `Page.printToPDF`.
///
/// The sheet and the margin are the ones `PrintToPdf` is given, from the same
/// function, and so are the backgrounds. `preferCSSPageSize` stays off for the
/// reason the paper travels with the layout: the sheet is the paper the
/// document was laid out on, not one a stylesheet names.
///
/// The outline is what this route is for, and it needs the tags: Chromium
/// builds the bookmarks from the structure tree, and measured, asking for an
/// outline without tags gives none. The tags are worth having in their own
/// right — a reader or a screen reader can follow them — and, measured, this
/// route's PDFs also carry the document's language, which `PrintToPdf`'s do
/// not.
pub fn print_params(
    custom_page: Option<(f64, f64)>,
    paged: bool,
    paper_id: Option<&str>,
) -> String {
    let ((width, height), margin) =
        crate::paper::webview2_sheet_inches(custom_page, paged, paper_id);
    serde_json::json!({
        "paperWidth": width,
        "paperHeight": height,
        "marginTop": margin,
        "marginBottom": margin,
        "marginLeft": margin,
        "marginRight": margin,
        "printBackground": true,
        "preferCSSPageSize": false,
        "generateDocumentOutline": true,
        "generateTaggedPDF": true,
    })
    .to_string()
}

/// Why an answer could not be used. The reader never sees it: `export_pdf`
/// prints through `PrintToPdf` instead, and logs this.
#[derive(Debug, PartialEq, Eq)]
pub enum Unusable {
    /// Not the JSON object the protocol answers with.
    NotJson,
    /// No `data` in it: the engine printed nothing.
    NoData,
    /// `data` that is not base64.
    NotBase64,
    /// Base64 of something that is not a PDF.
    NotPdf,
}

/// The one field of the answer that matters. Borrowed where the JSON allows,
/// because the PDF inside can be tens of megabytes.
#[derive(Deserialize)]
struct Answer<'a> {
    #[serde(borrow)]
    data: Option<Cow<'a, str>>,
}

/// The PDF in an answer to `Page.printToPDF`, checked to be one before
/// anything is written: a print that went wrong must not overwrite a file the
/// reader already has.
pub fn pdf_from_answer(answer: &str) -> Result<Vec<u8>, Unusable> {
    let answer: Answer = serde_json::from_str(answer).map_err(|_| Unusable::NotJson)?;
    let data = answer.data.ok_or(Unusable::NoData)?;
    let pdf = STANDARD
        .decode(data.as_bytes())
        .map_err(|_| Unusable::NotBase64)?;
    if !pdf.starts_with(b"%PDF-") {
        return Err(Unusable::NotPdf);
    }
    Ok(pdf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(
        custom_page: Option<(f64, f64)>,
        paged: bool,
        paper: Option<&str>,
    ) -> serde_json::Value {
        serde_json::from_str(&print_params(custom_page, paged, paper))
            .expect("the parameters are JSON")
    }

    #[test]
    fn asks_for_the_sheet_the_margin_and_the_outline() {
        let web = params(None, false, Some("letter"));
        assert_eq!(web["paperWidth"], 8.5);
        assert_eq!(web["paperHeight"], 11.0);
        let margin = web["marginLeft"].as_f64().expect("a margin");
        assert!(
            (margin - 25.0 / 25.4).abs() < 1e-9,
            "25 mm in inches, got {margin}"
        );
        for side in ["marginTop", "marginBottom", "marginRight"] {
            assert_eq!(web[side], web["marginLeft"], "{side}");
        }
        assert_eq!(web["printBackground"], true);
        assert_eq!(web["preferCSSPageSize"], false);
        assert_eq!(web["generateDocumentOutline"], true);
        assert_eq!(web["generateTaggedPDF"], true);
    }

    #[test]
    fn a_slide_and_a_paginated_document_bring_their_own_margins() {
        let slide = params(Some((13.333, 7.5)), true, None);
        assert_eq!(slide["paperWidth"], 13.333);
        assert_eq!(slide["paperHeight"], 7.5);
        assert_eq!(slide["marginTop"], 0.0);
        let paged = params(None, true, None);
        assert!(
            (paged["paperWidth"].as_f64().unwrap() - 8.27).abs() < 0.01,
            "A4 by default"
        );
        assert_eq!(paged["marginTop"], 0.0);
    }

    fn answer_with(data: &[u8]) -> String {
        format!("{{\"data\":\"{}\"}}", STANDARD.encode(data))
    }

    #[test]
    fn reads_the_pdf_out_of_the_answer() {
        // Nine bytes, then three that encode as "++++" and three as "////":
        // the standard alphabet, which the URL-safe one would refuse.
        let pdf = b"%PDF-1.4\n\xfb\xef\xbe\xff\xff\xff and the rest of it";
        assert!(answer_with(pdf).contains("++++////"));
        assert_eq!(pdf_from_answer(&answer_with(pdf)).as_deref(), Ok(&pdf[..]));
        // Other fields in the answer are none of its business.
        let with_more = answer_with(pdf).replacen('{', "{\"stream\":null,", 1);
        assert_eq!(pdf_from_answer(&with_more).as_deref(), Ok(&pdf[..]));
    }

    #[test]
    fn refuses_an_answer_it_cannot_use() {
        assert_eq!(pdf_from_answer("not json"), Err(Unusable::NotJson));
        assert_eq!(pdf_from_answer("{}"), Err(Unusable::NoData));
        assert_eq!(
            pdf_from_answer("{\"data\":\"***\"}"),
            Err(Unusable::NotBase64)
        );
        assert_eq!(
            pdf_from_answer(&answer_with(b"<html>")),
            Err(Unusable::NotPdf)
        );
    }
}
