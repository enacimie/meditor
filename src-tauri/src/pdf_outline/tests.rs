use super::*;
use lopdf::Stream;

const A4: [i64; 4] = [0, 0, 595, 842];

/// A PDF as an engine hands it over: `pages` sheets of `media_box`, the
/// box on each page or only on the page tree, and an outline of its own
/// or none.
fn engine_pdf(pages: usize, media_box: [i64; 4], box_on_pages: bool, outline: bool) -> Vec<u8> {
    let mut document = Document::with_version("1.4");
    let tree = document.new_object_id();
    let boxed = || Object::Array(media_box.iter().map(|&n| n.into()).collect());
    let kids: Vec<ObjectId> = (0..pages)
        .map(|_| {
            let content = document.add_object(Stream::new(dictionary! {}, b"BT ET".to_vec()));
            let mut page = dictionary! {
                "Type" => "Page",
                "Parent" => tree,
                "Contents" => content,
            };
            if box_on_pages {
                page.set("MediaBox", boxed());
            }
            document.add_object(page)
        })
        .collect();
    let mut node = dictionary! {
        "Type" => "Pages",
        "Kids" => kids.iter().map(|&kid| kid.into()).collect::<Vec<Object>>(),
        "Count" => pages as i64,
    };
    if !box_on_pages {
        node.set("MediaBox", boxed());
    }
    document.objects.insert(tree, Object::Dictionary(node));
    let mut catalog = dictionary! { "Type" => "Catalog", "Pages" => tree };
    if outline {
        let root = document.new_object_id();
        let item = document.add_object(dictionary! {
            "Title" => lopdf::text_string("Del motor"),
            "Parent" => root,
            "Dest" => vec![kids[0].into(), Object::Name(b"Fit".to_vec())],
        });
        document.objects.insert(
            root,
            Object::Dictionary(dictionary! {
                "Type" => "Outlines",
                "First" => item,
                "Last" => item,
                "Count" => 1,
            }),
        );
        catalog.set("Outlines", root);
    }
    let catalog = document.add_object(catalog);
    document.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).expect("a PDF to start from");
    bytes
}

/// pdf-outline.spec's document as the frontend sends it: a title, three
/// chapters over four pages, and a heading that skips a level.
fn chapters() -> Vec<PdfOutlineEntry> {
    vec![
        heading(1, "Informe de prueba", 0, 0.08),
        heading(1, "Primero", 0, 0.25),
        heading(2, "Uno punto uno", 0, 0.78),
        heading(1, "Segundo", 1, 0.58),
        heading(3, "Detalle", 2, 0.28),
        heading(1, "Tercero", 3, 0.08),
    ]
}

fn shape(read: &[(usize, String, usize, Option<f64>)]) -> Vec<(usize, &str, usize)> {
    read.iter()
        .map(|(depth, title, page, _)| (*depth, title.as_str(), *page))
        .collect()
}

/// The height expected, as closely as a PDF keeps one: a 32-bit real.
fn at(top: Option<f64>, expected: f64) -> bool {
    top.is_some_and(|top| (top - expected).abs() < 0.01)
}

#[test]
fn nests_the_headings_and_points_each_at_its_page_and_height() {
    let pdf = engine_pdf(4, A4, true, false);
    let read = bookmarks(&updated(&pdf, &chapters()).expect("something to add"));
    assert_eq!(
        shape(&read),
        [
            (1, "Informe de prueba", 0),
            (1, "Primero", 0),
            (2, "Uno punto uno", 0),
            (1, "Segundo", 1),
            (2, "Detalle", 2),
            (1, "Tercero", 3),
        ],
        "each heading once, nested as Chromium nests them: a skipped level sits under the heading above",
    );
    for ((_, title, _, top), fraction) in read.iter().zip([0.08, 0.25, 0.78, 0.58, 0.28, 0.08]) {
        assert!(
            at(*top, 842.0 * (1.0 - fraction)),
            "{title} should point {} pt up its page, measured from the foot; got {top:?}",
            842.0 * (1.0 - fraction),
        );
    }
}

#[test]
fn keeps_every_item_open_as_chromium_does() {
    let pdf = engine_pdf(4, A4, true, false);
    let document =
        Document::load_mem(&updated(&pdf, &chapters()).expect("something to add")).expect("parses");
    let outlines = document
        .catalog()
        .and_then(|catalog| catalog.get(b"Outlines"))
        .and_then(|outlines| document.dereference(outlines))
        .and_then(|(_, outlines)| outlines.as_dict())
        .expect("an outline");
    assert_eq!(
        outlines.get(b"Count").and_then(Object::as_i64).ok(),
        Some(6)
    );
    let count = |title: &str| {
        document.objects.values().find_map(|object| {
            let item = object.as_dict().ok()?;
            let read = lopdf::decode_text_string(item.get(b"Title").ok()?).ok()?;
            (read == title).then(|| item.get(b"Count").and_then(Object::as_i64).ok())
        })
    };
    assert_eq!(
        count("Primero"),
        Some(Some(1)),
        "open, over the one under it"
    );
    assert_eq!(
        count("Segundo"),
        Some(Some(1)),
        "open, over the one under it"
    );
    assert_eq!(
        count("Tercero"),
        Some(None),
        "nothing under it, so no count"
    );
}

#[test]
fn titles_in_any_script() {
    let pdf = engine_pdf(1, A4, true, false);
    let read = bookmarks(
        &updated(
            &pdf,
            &[
                heading(1, "Año Núñez, Ελληνικά", 0, 0.1),
                heading(2, "Método", 0, 0.5),
            ],
        )
        .expect("something to add"),
    );
    assert_eq!(
        shape(&read),
        [(1, "Año Núñez, Ελληνικά", 0), (2, "Método", 0)]
    );
}

#[test]
fn keeps_an_outline_the_engine_wrote() {
    let pdf = engine_pdf(2, A4, true, true);
    assert!(
        updated(&pdf, &[heading(1, "Uno", 0, 0.1)]).is_none(),
        "Chromium's own outline stays, and nothing is appended",
    );
}

#[test]
fn only_appends_to_what_the_engine_wrote() {
    let pdf = engine_pdf(4, A4, true, false);
    let updated = updated(&pdf, &chapters()).expect("something to add");
    assert!(
        updated.starts_with(&pdf),
        "an incremental update leaves the engine's bytes alone"
    );
    let tail = String::from_utf8_lossy(&updated[pdf.len()..]);
    assert!(
        tail.contains("/Prev"),
        "the new trailer should point back at the engine's cross-reference"
    );
    let document = Document::load_mem(&updated).expect("the result should parse");
    assert_eq!(
        document.get_pages().len(),
        4,
        "the pages should be the engine's"
    );
}

#[test]
fn leaves_out_the_headings_it_cannot_place() {
    let pdf = engine_pdf(2, A4, true, false);
    let read = bookmarks(
        &updated(
            &pdf,
            &[
                heading(1, "Uno", 0, 0.1),
                heading(1, "   ", 0, 0.2),
                heading(2, "Fuera", 5, 0.3),
                heading(1, "Sin altura", 1, f64::NAN),
                heading(2, "Más allá", 1, 7.0),
            ],
        )
        .expect("something to add"),
    );
    assert_eq!(
        shape(&read),
        [(1, "Uno", 0), (1, "Sin altura", 1), (2, "Más allá", 1)],
        "no text, or a page the PDF lacks: left out",
    );
    assert!(
        at(read[1].3, 842.0),
        "a height that is no number: the top of the page"
    );
    assert!(at(read[2].3, 0.0), "a height past the page: its foot");
}

#[test]
fn takes_the_size_from_the_page_tree_and_off_the_origin() {
    let pdf = engine_pdf(1, [0, 10, 612, 802], false, false);
    let read = bookmarks(&updated(&pdf, &[heading(1, "Uno", 0, 0.25)]).expect("something to add"));
    assert!(
        at(read[0].3, 802.0 - 0.25 * 792.0),
        "a quarter of the way down a box from 10 to 802, got {:?}",
        read[0].3,
    );
}

#[test]
fn adds_nothing_without_headings() {
    let pdf = engine_pdf(1, A4, true, false);
    assert!(updated(&pdf, &[]).is_none());
    assert!(
        updated(&pdf, &[heading(1, " ", 0, 0.0)]).is_none(),
        "blank is nothing"
    );
}

#[test]
fn leaves_what_is_not_a_pdf_alone() {
    assert!(updated(b"<html>not a pdf</html>", &chapters()).is_none());
}

#[test]
fn goes_on_top_of_the_metadata_and_in_place() {
    let dir = std::env::temp_dir().join(format!("meditor-pdf-outline-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a folder for the test");
    let path = dir.join("out.pdf");
    std::fs::write(&path, engine_pdf(4, A4, true, false)).expect("the engine's PDF");

    // As `export_pdf` does: the metadata first, then the bookmarks.
    let meta = crate::export::PdfMeta {
        author: Some("Ana".to_string()),
        ..Default::default()
    };
    crate::pdf_meta::add_to_file(Locale::En, &path, Some(&meta));
    add_to_file(Locale::En, &path, Some(&chapters()));
    let written = std::fs::read(&path).expect("the file");
    assert_eq!(
        bookmarks(&written).len(),
        6,
        "the bookmarks, over the metadata"
    );
    let document = Document::load_mem(&written).expect("parses");
    let author = document
        .trailer
        .get(b"Info")
        .and_then(Object::as_reference)
        .and_then(|id| document.get_dictionary(id))
        .and_then(|info| info.get(b"Author"))
        .and_then(lopdf::decode_text_string)
        .ok();
    assert_eq!(
        author.as_deref(),
        Some("Ana"),
        "and the metadata under them"
    );

    let before = std::fs::read(&path).expect("the file");
    add_to_file(Locale::En, &path, None);
    add_to_file(Locale::En, &path, Some(&[]));
    assert_eq!(
        std::fs::read(&path).expect("the file"),
        before,
        "no headings, no change"
    );

    std::fs::write(&path, b"not a pdf").expect("a broken file");
    add_to_file(Locale::En, &path, Some(&chapters()));
    assert_eq!(
        std::fs::read(&path).expect("the file"),
        b"not a pdf",
        "left as it was"
    );

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir(&dir);
}
