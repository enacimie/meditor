use serde::Deserialize;

/// Supported locales for error messages and dialog titles.
/// Mirrors the frontend's `Language` type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    En,
    Es,
    Fr,
    Ps,
    Sd,
    Zgh,
    Kab,
    Shi,
    Rif,
}

impl Locale {
    /// Fallback to English for unknown locale strings.
    pub fn from_str(s: &str) -> Self {
        match s {
            "es" => Locale::Es,
            "fr" => Locale::Fr,
            "ps" => Locale::Ps,
            "sd" => Locale::Sd,
            "zgh" => Locale::Zgh,
            "kab" => Locale::Kab,
            "shi" => Locale::Shi,
            "rif" => Locale::Rif,
            _ => Locale::En,
        }
    }
}

/// Translate an error message key into the given locale.
pub fn t(locale: Locale, key: &str) -> String {
    match locale {
        Locale::En => t_en(key),
        Locale::Es => t_es(key),
        Locale::Fr => t_fr(key),
        Locale::Ps => t_ps(key),
        Locale::Sd => t_sd(key),
        Locale::Zgh => t_zgh(key),
        Locale::Kab => t_kab(key),
        Locale::Shi => t_shi(key),
        Locale::Rif => t_rif(key),
    }
}

/// Format a translatable message with one argument.
pub fn tf(locale: Locale, key: &str, arg: &str) -> String {
    t(locale, key).replace("{0}", arg)
}

fn t_en(key: &str) -> String {
    match key {
        "file.emptyPath" => "Empty or invalid file path",
        "file.isDirectory" => "Path points to a directory",
        "file.noParent" => "Path has no parent folder",
        "file.noFileName" => "Path has no file name",
        "file.notFound" => "Path does not point to a file",
        "file.tooLarge" => "File exceeds the {0} MiB limit",
        "file.contentTooLarge" => "Content exceeds the {0} MiB limit",
        "file.documentUnavailable" => "Document is no longer available for saving",
        "file.directoryMissing" => "Destination folder does not exist",
        "file.registryLock" => "Could not access document registry",
        "file.sessionUnavailable" => "A document is no longer available",
        "file.sessionTooLarge" => "Session exceeds the allowed limit",
        "file.docTooLarge" => "A document exceeds the allowed limit",
        "file.openFailed" => "Could not open document: {0}",
        "file.saveFailed" => "Could not save: {0}",
        "pdf.notSupported" => "PDF export is not supported on this platform yet",
        "pdf.invalidPath" => "Invalid export path",
        "pdf.directoryMissing" => "Destination folder does not exist",
        "pdf.waitFailed" => "PDF export wait failed: {0}",
        "pdf.timeout" => "PDF export timed out",
        "pdf.emptyFile" => "PDF export produced an empty file",
        "pdf.invalidPdf" => "Export did not produce a valid PDF file",
        "confirm.title" => "Confirm",
        "alert.title" => "Error",
        "doc.untitled" => "Document",
        _ => key,
    }
    .to_string()
}

fn t_es(key: &str) -> String {
    match key {
        "file.emptyPath" => "Ruta de archivo vacía o inválida",
        "file.isDirectory" => "La ruta apunta a un directorio",
        "file.noParent" => "La ruta no tiene carpeta padre",
        "file.noFileName" => "La ruta no tiene nombre de archivo",
        "file.notFound" => "La ruta no apunta a un archivo",
        "file.tooLarge" => "El archivo supera el límite de {0} MiB",
        "file.contentTooLarge" => "El contenido supera el límite de {0} MiB",
        "file.documentUnavailable" => "El documento ya no está disponible para guardar",
        "file.directoryMissing" => "La carpeta de destino no existe",
        "file.registryLock" => "No se pudo acceder al registro de documentos",
        "file.sessionUnavailable" => "Un documento ya no está disponible",
        "file.sessionTooLarge" => "La sesión supera el límite permitido",
        "file.docTooLarge" => "Un documento supera el límite permitido",
        "file.openFailed" => "No se pudo abrir el documento: {0}",
        "file.saveFailed" => "No se pudo guardar: {0}",
        "pdf.notSupported" => "Exportar a PDF aún no está soportado en esta plataforma",
        "pdf.invalidPath" => "Ruta de exportación inválida",
        "pdf.directoryMissing" => "La carpeta de destino no existe",
        "pdf.waitFailed" => "La espera de exportación PDF falló: {0}",
        "pdf.timeout" => "La exportación PDF no terminó a tiempo",
        "pdf.emptyFile" => "La exportación PDF produjo un archivo vacío",
        "pdf.invalidPdf" => "La exportación no produjo un archivo PDF válido",
        "confirm.title" => "Confirmar",
        "alert.title" => "Error",
        "doc.untitled" => "Documento",
        _ => key,
    }
    .to_string()
}

fn t_fr(key: &str) -> String {
    match key {
        "file.emptyPath" => "Chemin de fichier vide ou invalide",
        "file.isDirectory" => "Le chemin pointe vers un dossier",
        "file.noParent" => "Le chemin n'a pas de dossier parent",
        "file.noFileName" => "Le chemin n'a pas de nom de fichier",
        "file.notFound" => "Le chemin ne pointe pas vers un fichier",
        "file.tooLarge" => "Le fichier dépasse la limite de {0} Mio",
        "file.contentTooLarge" => "Le contenu dépasse la limite de {0} Mio",
        "file.documentUnavailable" => "Le document n'est plus disponible pour l'enregistrement",
        "file.directoryMissing" => "Le dossier de destination n'existe pas",
        "file.registryLock" => "Impossible d'accéder au registre des documents",
        "file.sessionUnavailable" => "Un document n'est plus disponible",
        "file.sessionTooLarge" => "La session dépasse la limite autorisée",
        "file.docTooLarge" => "Un document dépasse la limite autorisée",
        "file.openFailed" => "Impossible d'ouvrir le document : {0}",
        "file.saveFailed" => "Impossible d'enregistrer : {0}",
        "pdf.notSupported" => "L'export PDF n'est pas encore supporté sur cette plateforme",
        "pdf.invalidPath" => "Chemin d'export invalide",
        "pdf.directoryMissing" => "Le dossier de destination n'existe pas",
        "pdf.waitFailed" => "L'attente d'export PDF a échoué : {0}",
        "pdf.timeout" => "L'export PDF a expiré",
        "pdf.emptyFile" => "L'export PDF a produit un fichier vide",
        "pdf.invalidPdf" => "L'export n'a pas produit un fichier PDF valide",
        "confirm.title" => "Confirmer",
        "alert.title" => "Erreur",
        "doc.untitled" => "Document",
        _ => key,
    }
    .to_string()
}

fn t_ps(key: &str) -> String {
    match key {
        "file.emptyPath" => "د فایل خالي یا ناسمه لار",
        "file.isDirectory" => "لار یوې پوښې ته اشاره کوي",
        "file.noParent" => "لار اصلي پوښه نلري",
        "file.noFileName" => "لار د فایل نوم نلري",
        "file.notFound" => "لار یوه فایل ته اشاره نه کوي",
        "file.tooLarge" => "فایل د {0} MiB له حد څخه تېر شو",
        "file.contentTooLarge" => "محتوا د {0} MiB له حد څخه تېره شوه",
        "file.documentUnavailable" => "سند نور د خوندي کولو لپاره شتون نلري",
        "file.directoryMissing" => "د منزل پوښه شتون نلري",
        "file.registryLock" => "د سند راجسټرۍ ته لاسرسی ممکن نه و",
        "file.sessionUnavailable" => "یو سند نور شتون نلري",
        "file.sessionTooLarge" => "غونډه د اجازې له حد څخه تېره شوه",
        "file.docTooLarge" => "یو سند د اجازې له حد څخه تېر شو",
        "file.openFailed" => "سند پرانیستل کېدی نشو: {0}",
        "file.saveFailed" => "خوندي کول کېدی نشو: {0}",
        "pdf.notSupported" => "PDF صادرول لا تر اوسه پر دې پلیټفارم ملاتړ نه کېږي",
        "pdf.invalidPath" => "د صادراتو ناسمه لار",
        "pdf.directoryMissing" => "د منزل پوښه شتون نلري",
        "pdf.waitFailed" => "د PDF صادرولو انتظار ناکام شو: {0}",
        "pdf.timeout" => "د PDF صادرولو وخت پای ته ورسېد",
        "pdf.emptyFile" => "د PDF صادراتو یو خالي فایل جوړ کړ",
        "pdf.invalidPdf" => "صادراتو یو معتبر PDF فایل نه دی جوړ کړی",
        "confirm.title" => "تایید",
        "alert.title" => "تېروتنه",
        "doc.untitled" => "سند",
        _ => key,
    }
    .to_string()
}

fn t_sd(key: &str) -> String {
    match key {
        "file.emptyPath" => "خالي يا غلط فائل رستو",
        "file.isDirectory" => "رستو هڪ ڊائريڪٽري ڏانهن اشارو ڪري ٿو",
        "file.noParent" => "رستو ۾ اصلي فولڊر ناهي",
        "file.noFileName" => "رستو ۾ فائل جو نالو ناهي",
        "file.notFound" => "رستو ڪنهن فائل ڏانهن اشارو نٿو ڪري",
        "file.tooLarge" => "فائل {0} MiB جي حد کان وڌي وئي",
        "file.contentTooLarge" => "مواد {0} MiB جي حد کان وڌي ويو",
        "file.documentUnavailable" => "دستاويز هاڻي محفوظ ڪرڻ لاءِ دستياب ناهي",
        "file.directoryMissing" => "منزل وارو فولڊر موجود ناهي",
        "file.registryLock" => "دستاويز جي رجسٽري تائين رسائي ممڪن نه هئي",
        "file.sessionUnavailable" => "هڪ دستاويز هاڻي دستياب ناهي",
        "file.sessionTooLarge" => "سيشن اجازت واري حد کان وڌي ويو",
        "file.docTooLarge" => "هڪ دستاويز اجازت واري حد کان وڌي ويو",
        "file.openFailed" => "دستاويز کولي نه سگهيو: {0}",
        "file.saveFailed" => "محفوظ ڪري نه سگهيو: {0}",
        "pdf.notSupported" => "PDF برآمدگي اڃا هن پليٽ فارم تي سپورٽ ٿيل ناهي",
        "pdf.invalidPath" => "برآمد جو غلط رستو",
        "pdf.directoryMissing" => "منزل وارو فولڊر موجود ناهي",
        "pdf.waitFailed" => "PDF برآمد جو انتظار ناڪام ٿيو: {0}",
        "pdf.timeout" => "PDF برآمد جو وقت ختم ٿي ويو",
        "pdf.emptyFile" => "PDF برآمد هڪ خالي فائل ٺاهي",
        "pdf.invalidPdf" => "برآمد هڪ صحيح PDF فائل ناهي ٺاهي",
        "confirm.title" => "تصديق",
        "alert.title" => "غلطي",
        "doc.untitled" => "دستاويز",
        _ => key,
    }
    .to_string()
}

fn t_zgh(key: &str) -> String {
    match key {
        "confirm.title" => "ⵙⵙⵏⴽⴷ".to_string(),
        "alert.title" => "ⴰⵣⴳⴰⵍ".to_string(),
        "doc.untitled" => "ⴰⵔⵔⴰⵜ".to_string(),
        _ => t_en(key),
    }
}

fn t_kab(key: &str) -> String {
    match key {
        "confirm.title" => "Ssenked".to_string(),
        "alert.title" => "Azzal".to_string(),
        "doc.untitled" => "Arrat".to_string(),
        _ => t_en(key),
    }
}

fn t_shi(key: &str) -> String {
    match key {
        "confirm.title" => "ⵙⵙⵏⴽⴷ".to_string(),
        "alert.title" => "ⴰⵣⴳⴰⵍ".to_string(),
        "doc.untitled" => "ⴰⵔⵔⴰⵜ".to_string(),
        _ => t_en(key),
    }
}

fn t_rif(key: &str) -> String {
    match key {
        "confirm.title" => "Ssenked".to_string(),
        "alert.title" => "Azzar".to_string(),
        "doc.untitled" => "Arrat".to_string(),
        _ => t_en(key),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_keys_for_all_languages() {
        assert_eq!(t(Locale::En, "confirm.title"), "Confirm");
        assert_eq!(t(Locale::Es, "confirm.title"), "Confirmar");
        assert_eq!(t(Locale::Fr, "confirm.title"), "Confirmer");
        assert_eq!(t(Locale::En, "alert.title"), "Error");
        assert_eq!(t(Locale::Es, "alert.title"), "Error");
        assert_eq!(t(Locale::Fr, "alert.title"), "Erreur");
        assert_eq!(t(Locale::En, "doc.untitled"), "Document");
        assert_eq!(t(Locale::Es, "doc.untitled"), "Documento");
        assert_eq!(t(Locale::Fr, "doc.untitled"), "Document");
    }

    #[test]
    fn formats_arguments() {
        assert_eq!(
            tf(Locale::En, "file.tooLarge", "64"),
            "File exceeds the 64 MiB limit"
        );
        assert_eq!(
            tf(Locale::Es, "file.tooLarge", "64"),
            "El archivo supera el límite de 64 MiB"
        );
        assert_eq!(
            tf(Locale::Fr, "file.tooLarge", "64"),
            "Le fichier dépasse la limite de 64 Mio"
        );
    }

    #[test]
    fn from_str_parses_correctly() {
        assert_eq!(Locale::from_str("en"), Locale::En);
        assert_eq!(Locale::from_str("es"), Locale::Es);
        assert_eq!(Locale::from_str("fr"), Locale::Fr);
        assert_eq!(Locale::from_str("ps"), Locale::Ps);
        assert_eq!(Locale::from_str("sd"), Locale::Sd);
        assert_eq!(Locale::from_str("zgh"), Locale::Zgh);
        assert_eq!(Locale::from_str("kab"), Locale::Kab);
        assert_eq!(Locale::from_str("shi"), Locale::Shi);
        assert_eq!(Locale::from_str("rif"), Locale::Rif);
    }

    #[test]
    fn from_str_falls_back_to_english() {
        assert_eq!(Locale::from_str("de"), Locale::En);
        assert_eq!(Locale::from_str("pt"), Locale::En);
        assert_eq!(Locale::from_str(""), Locale::En);
    }

    #[test]
    fn unknown_key_returns_key_itself() {
        assert_eq!(t(Locale::En, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Es, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Fr, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Ps, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Sd, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Zgh, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Kab, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Shi, "nonexistent.key"), "nonexistent.key");
        assert_eq!(t(Locale::Rif, "nonexistent.key"), "nonexistent.key");
    }

    #[test]
    fn all_pdf_keys_translate() {
        for key in [
            "pdf.notSupported",
            "pdf.invalidPath",
            "pdf.directoryMissing",
            "pdf.timeout",
            "pdf.emptyFile",
            "pdf.invalidPdf",
        ] {
            for locale in [
                Locale::En,
                Locale::Es,
                Locale::Fr,
                Locale::Ps,
                Locale::Sd,
                Locale::Zgh,
                Locale::Kab,
                Locale::Shi,
                Locale::Rif,
            ] {
                let result = t(locale, key);
                assert!(!result.is_empty());
                assert_ne!(result, key);
            }
        }
    }

    #[test]
    fn all_file_keys_translate() {
        for key in [
            "file.emptyPath",
            "file.isDirectory",
            "file.noParent",
            "file.noFileName",
            "file.notFound",
            "file.documentUnavailable",
            "file.directoryMissing",
            "file.registryLock",
            "file.sessionUnavailable",
            "file.sessionTooLarge",
            "file.docTooLarge",
        ] {
            for locale in [
                Locale::En,
                Locale::Es,
                Locale::Fr,
                Locale::Ps,
                Locale::Sd,
                Locale::Zgh,
                Locale::Kab,
                Locale::Shi,
                Locale::Rif,
            ] {
                let result = t(locale, key);
                assert!(!result.is_empty());
                assert_ne!(result, key);
            }
        }
    }
}
