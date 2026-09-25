//! Reading the PDFs Chromium writes, as far as the WebView2 harness needs to.
//!
//! Chromium prints through Skia's PDF backend, which writes PDF 1.4: every
//! dictionary as plain text, and only the pages' drawing deflated. So the
//! structure is read as text and only the drawing is inflated. Not a PDF
//! parser: a reader for this one writer, which is what the harness prints
//! with.

use std::collections::HashMap;

/// How many pages a PDF has: its page objects, `/Type /Page`, and not the
/// `/Type /Pages` tree above them. Counted this way rather than by
/// `/MediaBox`, which a writer may also put on that tree.
pub(super) fn page_count(pdf: &[u8]) -> usize {
    let mut count = 0;
    let mut at = 0;
    while let Some(found) = pdf[at..].windows(5).position(|w| w == b"/Type") {
        let mut rest = at + found + 5;
        while pdf.get(rest).is_some_and(|b| b.is_ascii_whitespace()) {
            rest += 1;
        }
        if pdf[rest..].starts_with(b"/Page") && !pdf[rest..].starts_with(b"/Pages") {
            count += 1;
        }
        at = rest;
    }
    count
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// The first page's drawing instructions, which Chromium writes deflated:
/// the first stream that inflates to text placing something with `cm`.
pub(super) fn first_page_content(pdf: &[u8]) -> Option<String> {
    let mut at = 0;
    while let Some(found) = find(&pdf[at..], b"stream") {
        let mut start = at + found + b"stream".len();
        while pdf.get(start).is_some_and(|b| *b == b'\r' || *b == b'\n') {
            start += 1;
        }
        let length = find(&pdf[start..], b"endstream")?;
        at = start + length + b"endstream".len();
        let mut data = &pdf[start..start + length];
        while data.last().is_some_and(|b| *b == b'\r' || *b == b'\n') {
            data = &data[..data.len() - 1];
        }
        let Ok(inflated) = miniz_oxide::inflate::decompress_to_vec_zlib(data) else {
            continue;
        };
        let text = String::from_utf8_lossy(&inflated).into_owned();
        if text.split_whitespace().any(|token| token == "cm") {
            return Some(text);
        }
    }
    None
}

/// How the first page drew its sheet: at what scale, as a fraction of
/// full size, and how far in from the left edge, in points.
///
/// The drawing's first `cm` turns device units, a three-hundredth of an
/// inch, into points: 0.24 per unit. The second places the page's CSS
/// pixels, and at full size a CSS pixel is 300/96 = 3.125 of those units.
/// A printer margin shows in both: the sheet drawn smaller, and moved in
/// from the edge.
pub(super) fn first_page_placement(pdf: &[u8]) -> Option<(f64, f64)> {
    let text = first_page_content(pdf)?;
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let matrices: Vec<Vec<f64>> = tokens
        .iter()
        .enumerate()
        .filter(|(i, token)| **token == "cm" && *i >= 6)
        .filter_map(|(i, _)| tokens[i - 6..i].iter().map(|t| t.parse().ok()).collect())
        .collect();
    match matrices.as_slice() {
        [device, page, ..] => Some((page[0] / 3.125, page[4] * device[0].abs())),
        _ => None,
    }
}

/// How many link annotations the PDF has: the table of contents' among them.
pub(super) fn link_count(pdf: &[u8]) -> usize {
    pdf.windows(b"/Subtype /Link".len())
        .filter(|w| *w == b"/Subtype /Link")
        .count()
}

/// The PDF's outline, its bookmarks, as (depth, title) in reading order: from
/// the catalog's `/Outlines`, each item before its `/First` child, and that
/// before its `/Next` sibling.
pub(super) fn outline(pdf: &[u8]) -> Vec<(usize, String)> {
    let objects = objects(pdf);
    let mut items = Vec::new();
    let root = objects
        .values()
        .find(|body| body.contains("/Type /Catalog"))
        .and_then(|catalog| reference(catalog, "/Outlines"));
    if let Some(root) = root.and_then(|number| objects.get(&number)) {
        walk(&objects, reference(root, "/First"), 1, &mut items);
    }
    items
}

fn walk(
    objects: &HashMap<u32, String>,
    first: Option<u32>,
    depth: usize,
    items: &mut Vec<(usize, String)>,
) {
    let mut next = first;
    // A broken PDF could chain its items into a loop; no test document has
    // anywhere near this many headings.
    while let Some(body) = next.and_then(|number| objects.get(&number)) {
        if items.len() > 1000 {
            return;
        }
        items.push((depth, title(body).unwrap_or_default()));
        walk(objects, reference(body, "/First"), depth + 1, items);
        next = reference(body, "/Next");
    }
}

/// Every object in the PDF, by number, as the text between `N 0 obj` and its
/// `endobj`. Each byte becomes one `char`, so strings keep their bytes.
fn objects(pdf: &[u8]) -> HashMap<u32, String> {
    let text: String = pdf.iter().map(|&b| char::from(b)).collect();
    let mut objects = HashMap::new();
    let mut at = 0;
    while let Some(found) = text[at..].find(" 0 obj") {
        let marker = at + found;
        let digits = text[..marker]
            .chars()
            .rev()
            .take_while(char::is_ascii_digit)
            .count();
        let start = marker + " 0 obj".len();
        let Some(length) = text[start..].find("endobj") else {
            break;
        };
        if let Ok(number) = text[marker - digits..marker].parse() {
            objects.insert(number, text[start..start + length].to_string());
        }
        at = start + length;
    }
    objects
}

/// The object `key` refers to in `body`, as in `/First 12 0 R`.
fn reference(body: &str, key: &str) -> Option<u32> {
    let at = body.find(&format!("{key} "))? + key.len();
    let rest = body[at..].trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    rest[digits.len()..]
        .trim_start()
        .starts_with("0 R")
        .then(|| digits.parse().ok())
        .flatten()
}

/// The text of the `/Title` in `body`, from a hex string or a literal one, in
/// UTF-16 when it opens with the byte order mark, as Chromium writes any
/// title that is not plain ASCII.
fn title(body: &str) -> Option<String> {
    let at = body.find("/Title")? + "/Title".len();
    let rest = body[at..].trim_start();
    let bytes: Vec<u8> = if let Some(hex) = rest.strip_prefix('<') {
        let digits: Vec<u8> = hex
            .chars()
            .take_while(|c| *c != '>')
            .filter_map(|c| c.to_digit(16))
            .map(|d| d as u8)
            .collect();
        digits
            .chunks(2)
            .map(|pair| pair[0] << 4 | pair.get(1).copied().unwrap_or(0))
            .collect()
    } else {
        literal_bytes(rest.strip_prefix('(')?)
    };
    Some(match bytes.strip_prefix(&[0xfe, 0xff]) {
        Some(utf16) => String::from_utf16_lossy(
            &utf16
                .chunks(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair.get(1).copied().unwrap_or(0)]))
                .collect::<Vec<_>>(),
        ),
        None => bytes.iter().map(|&b| char::from(b)).collect(),
    })
}

/// The bytes of a literal string, from just after its opening parenthesis.
fn literal_bytes(literal: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut chars = literal.chars().peekable();
    let mut depth = 1;
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.next() {
                Some(first @ '0'..='7') => {
                    let mut octal = first.to_digit(8).unwrap_or(0);
                    for _ in 0..2 {
                        match chars.peek().and_then(|c| c.to_digit(8)) {
                            Some(digit) => {
                                octal = octal * 8 + digit;
                                chars.next();
                            }
                            None => break,
                        }
                    }
                    bytes.push(octal as u8);
                }
                Some('n') => bytes.push(b'\n'),
                Some('r') => bytes.push(b'\r'),
                Some('t') => bytes.push(b'\t'),
                Some(other) => bytes.push(other as u8),
                None => break,
            },
            '(' => {
                depth += 1;
                bytes.push(b'(');
            }
            ')' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
                bytes.push(b')');
            }
            other => bytes.push(other as u8),
        }
    }
    bytes
}
