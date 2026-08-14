# Author lesson packs in Excel

This document defines the supported Excel authoring format for English Recall. Use the official template, keep the first worksheet named `Lesson Pack`, save the workbook as `.xlsx`, and import it from the app.

Download the template from the app or use `public/assets/english-recall-lesson-pack-template.xlsx` in this repository.

## Row model

One data row defines one target occurrence. Authors provide readable learning content only; do not add `schemaVersion`, character spans, or internal IDs. English Recall derives stable IDs and exact spans, groups the rows, and validates the generated result with the production `parseLessonPack` schemaVersion 3 parser.

Use these columns exactly and in this order:

1. `Pack`
2. `Lesson`
3. `Topic`
4. `Level`
5. `English sentence`
6. `Vietnamese translation`
7. `Target`
8. `Lemma`
9. `Part of speech`
10. `Meaning VI`
11. `Distractor 1`
12. `Distractor 2`
13. `Distractor 3`
14. `Explanation`

`Explanation` is optional. Every other cell is required and must contain text. Unknown, missing, or duplicate columns are rejected.

## Column rules

- `Pack`: Human-readable pack title. Rows with the same normalized value belong to one pack.
- `Lesson`: Human-readable lesson title. Rows with the same normalized value inside a pack belong to one lesson.
- `Topic`: A concise topic label shared by a sentence, such as `daily-routine`.
- `Level`: One of `A1`, `A2`, `B1`, `B2`, `C1`, or `C2`.
- `English sentence`: The complete sentence shown and spoken by English Recall.
- `Vietnamese translation`: The complete Vietnamese translation.
- `Target`: The exact, case-sensitive surface text as it occurs in `English sentence`. For an inflected form, enter the form used in the sentence, such as `went`, `worked`, or `was`.
- `Lemma`: The stable dictionary form used for mastery and SRS identity, such as `go`, `work`, or `be`.
- `Part of speech`: One of `noun`, `verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `determiner`, `interjection`, `phrase`, or `other`.
- `Meaning VI`: The Vietnamese meaning of the lemma.
- `Distractor 1`, `Distractor 2`, `Distractor 3`: Three context-appropriate surface forms that reference three different lexemes already defined by Target/Lemma rows in the same pack.
- `Explanation`: Optional concise learning note. It must be identical on all rows for the same sentence.

The importer reuses a lexeme when normalized `Lemma` and `Part of speech` match. This means `go` and `went` can share one lexeme. If the same lemma and part of speech are repeated with a conflicting `Meaning VI`, import fails with the row number.

## Exact occurrences and multiple targets

`Target` normally contains only the exact surface text. If that text occurs more than once in the sentence, append a one-based occurrence suffix:

- `go#1` selects the first exact `go` occurrence.
- `go#2` selects the second exact `go` occurrence.

The suffix is authoring syntax only. It is removed from `surfaceText` in the generated JSON. Import fails when the target text is missing, the occurrence is ambiguous without `#N`, or the requested occurrence does not exist.

To create multiple targets in one sentence, add one row per target and repeat the same `Pack`, `Lesson`, `Topic`, `Level`, `English sentence`, `Vietnamese translation`, and `Explanation`. A sentence supports one to four non-overlapping targets. Repeating the same target occurrence is rejected.

## Distractor references

Each target requires exactly three distinct distractor lexemes. Every distractor must reference an existing lexeme in the same pack and must not resolve to the target's own lexeme.

The preferred value is the context-appropriate surface form, for example `worked`. When that surface is ambiguous, qualify it with one of these deterministic forms:

- `surface | partOfSpeech`
- `surface | lemma | partOfSpeech`

Example: `went | go | verb` displays `went` and references the lexeme identified by lemma `go` and part of speech `verb`.

A referenced lexeme must be defined by at least one Target/Lemma row somewhere in the same pack. The production schema requires at least four lexemes in a pack, so a valid workbook must define enough targets to make the target plus its three distractor lexemes available.

## Grouping and generated metadata

The importer may contain multiple packs. Within each pack, rows are grouped into lessons and sentences. Internal pack, lesson, sentence, target, and lexeme IDs are stable deterministic slug/hash values derived from normalized author content. Authors must not depend on row numbers as identity.

Generated packs use:

- `schemaVersion: 3`
- `version: 1.0.0`
- `sourceLanguage: vi`
- `targetLanguage: en-US`
- `speechText` equal to the English sentence

All generated packs pass through `parseLessonPack` before they are returned for persistence. A schema failure rejects the affected import; invalid rows are reported with Excel row numbers and, when applicable, column names.

## Import checklist

- Keep the official headers unchanged.
- Keep all cells as text.
- Define at least four distinct lemma plus part-of-speech identities in each pack.
- Make each Target match its sentence exactly, using `#N` only for repeated exact occurrences.
- Repeat sentence metadata exactly on rows that add another target to the same sentence.
- Use exactly three different, existing, non-self distractor lexemes per target.
- Save as `.xlsx`; legacy `.xls` files are not supported.
