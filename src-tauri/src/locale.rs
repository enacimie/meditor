use serde::Deserialize;

/// Supported locales for error messages and dialog titles.
/// Mirrors the frontend's `Language` type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    En,
    Es,
    Fr,
}

impl Locale {
    /// Fallback to English for unknown locale strings.
    pub fn from_str(s: &str) -> Self {
        match s {
            "es" => Locale::Es,
            "fr" => Locale::Fr,
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
        "pdf.notSupported" => "PDF export is only supported on Linux for now",
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
        "pdf.notSupported" => "Exportar PDF solo está soportado en Linux por ahora",
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
        "pdf.notSupported" => "L'export PDF n'est supporté que sur Linux pour l'instant",
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
        assert_eq!(tf(Locale::En, "file.tooLarge", "64"), "File exceeds the 64 MiB limit");
        assert_eq!(tf(Locale::Es, "file.tooLarge", "64"), "El archivo supera el límite de 64 MiB");
        assert_eq!(tf(Locale::Fr, "file.tooLarge", "64"), "Le fichier dépasse la limite de 64 Mio");
    }

    #[test]
    fn from_str_parses_correctly() {
        assert_eq!(Locale::from_str("en"), Locale::En);
        assert_eq!(Locale::from_str("es"), Locale::Es);
        assert_eq!(Locale::from_str("fr"), Locale::Fr);
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
    }

    #[test]
    fn all_pdf_keys_translate() {
        for key in ["pdf.notSupported","pdf.invalidPath","pdf.directoryMissing","pdf.timeout","pdf.emptyFile","pdf.invalidPdf"] {
            for locale in [Locale::En, Locale::Es, Locale::Fr] {
                let result = t(locale, key);
                assert!(!result.is_empty());
                assert_ne!(result, key);
            }
        }
    }

    #[test]
    fn all_file_keys_translate() {
        for key in ["file.emptyPath","file.isDirectory","file.noParent","file.noFileName","file.notFound","file.documentUnavailable","file.directoryMissing","file.registryLock","file.sessionUnavailable","file.sessionTooLarge","file.docTooLarge"] {
            for locale in [Locale::En, Locale::Es, Locale::Fr] {
                let result = t(locale, key);
                assert!(!result.is_empty());
                assert_ne!(result, key);
            }
        }
    }
}
