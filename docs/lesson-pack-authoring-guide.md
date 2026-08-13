# Lesson Pack Authoring Guide

English Recall does not use SQL or a backend. Its lesson database is a JSON
file that follows lesson-pack schema version 3. When a file is imported, the
application validates the complete pack before storing it in the browser's
IndexedDB.

This document is the authoritative content-authoring reference for English
Recall lesson-pack JSON files. Authors and AI systems generating lesson content
should follow every rule below exactly. The schema is strict: fields not defined
by the schema are rejected.

## 1. Create the JSON file

Create a file such as `my-daily-english.json`:

```json
{
  "schemaVersion": 3,
  "id": "my-daily-english",
  "version": "1.0.0",
  "title": "My Daily English",
  "description": "Các câu tiếng Anh tôi dùng hằng ngày.",
  "sourceLanguage": "vi",
  "targetLanguage": "en-US",
  "lexemes": [
    {
      "id": "usually.adv.01",
      "lemma": "usually",
      "spokenText": "usually",
      "partOfSpeech": "adverb",
      "meaningVi": "thường"
    },
    {
      "id": "always.adv.01",
      "lemma": "always",
      "partOfSpeech": "adverb",
      "meaningVi": "luôn luôn"
    },
    {
      "id": "sometimes.adv.01",
      "lemma": "sometimes",
      "partOfSpeech": "adverb",
      "meaningVi": "thỉnh thoảng"
    },
    {
      "id": "rarely.adv.01",
      "lemma": "rarely",
      "partOfSpeech": "adverb",
      "meaningVi": "hiếm khi"
    }
  ],
  "lessons": [
    {
      "id": "daily-habits",
      "title": "Daily habits",
      "summary": "Trạng từ tần suất trong sinh hoạt hằng ngày.",
      "estimatedMinutes": 3,
      "sentences": [
        {
          "id": "usually-work-home",
          "displayText": "I usually work from home.",
          "speechText": "I usually work from home.",
          "translationVi": "Tôi thường làm việc tại nhà.",
          "level": "A1",
          "topic": "daily-habits",
          "explanation": "Usually đứng trước động từ thường để nói về tần suất.",
          "targets": [
            {
              "id": "usually",
              "lexemeId": "usually.adv.01",
              "start": 2,
              "end": 9,
              "surfaceText": "usually",
              "distractors": [
                { "lexemeId": "always.adv.01", "surfaceText": "always" },
                { "lexemeId": "sometimes.adv.01", "surfaceText": "sometimes" },
                { "lexemeId": "rarely.adv.01", "surfaceText": "rarely" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

A pack requires at least four lexemes because every target has one correct
lexeme and exactly three distractors. Choose distractors with a compatible part
of speech and a plausible contextual form so that the exercise remains useful.

Apply these identity and reference rules:

- `lexeme.id` must be unique within the pack.
- `lesson.id` must be unique within the pack.
- `sentence.id` must be unique across the entire pack, including across
  different lessons.
- `target.id` must be unique within its sentence.
- Every target's `lexemeId` must reference an existing lexeme in the pack.
- Every target must contain exactly three distractors with three different
  `lexemeId` values.
- Every distractor `lexemeId` must reference an existing lexeme in the pack.
- A distractor must not use the same `lexemeId` as its target.

Pack `version` must use the `major.minor.patch` semantic-version format. A pack
must contain at least one lesson; every lesson must contain at least one
sentence; and every sentence must contain between one and four targets. Valid
`level` values are `A1`, `A2`, `B1`, `B2`, `C1`, and `C2`. Valid
`partOfSpeech` values are `noun`, `verb`, `adjective`, `adverb`, `pronoun`,
`preposition`, `conjunction`, `determiner`, `interjection`, `phrase`, and
`other`.

## 2. Calculate `start` and `end`

`start` is the zero-based position of the target's first character. `end` is
the position immediately after its final character. You can verify both values
with Node.js or browser DevTools:

```js
const text = 'I usually work from home.'
const word = 'usually'
const start = text.indexOf(word)
console.log({ start, end: start + word.length })
// { start: 2, end: 9 }
```

`displayText.slice(start, end)` must equal `target.surfaceText`, ignoring letter
case. The range must stay inside `displayText`, `end` must be greater than
`start`, and target ranges in the same sentence must not overlap. JavaScript
string indexes are UTF-16 character offsets, so calculate spans with JavaScript
when the sentence contains emoji or characters represented by surrogate pairs.

## 3. Reuse one word in multiple contexts

Do not create a new lexeme for every sentence. Keep the same stable `lexemeId`,
such as `usually.adv.01`, and reference it from multiple sentences. All of those
contexts then update the same mastery/SRS record for “usually.”

For inflected or irregular forms, keep the lemma unchanged and put the exact
form used by the sentence in each target's `surfaceText`. For example, the
lexeme `{ "id": "go.verb.01", "lemma": "go" }` can be referenced by a target
with `surfaceText: "go"` in one sentence and `surfaceText: "went"` in another.
Word Choice and Fill Words use `surfaceText`, while mastery remains keyed by
`go.verb.01`. Each distractor also needs a `surfaceText` appropriate for the
sentence context; its `lexemeId` remains the stable mastery identity it
references.

## 4. Import the pack into the application

1. Open **Home**.
2. Select **Import JSON**.
3. Choose the JSON file you created.
4. After the success message appears, find the new pack in **Lesson library**.
5. Open a lesson and test Word Choice, Fill Words, and Listening Choice from the
   `⋮` menu.

If any schema field, ID, reference, or character span is invalid, English
Recall rejects the entire file and displays an error. Do not use
`english-recall-starter` as a custom pack ID because it belongs to the bundled
starter content.

## 5. Update and preserve lesson content

- To update a pack, keep its `id`, increase its semantic `version`, and import
  it again. English Recall replaces the installed pack only when the update is
  valid and follows its version-safety rules. A downgrade, or changed content
  with the same version, is rejected.
- Always retain the original authored lesson-pack JSON file. English Recall
  currently has no dedicated lesson-pack JSON export.
- **Learner Backup** is a separate feature for moving installed packs, settings,
  active-session state, and learner progress. It is not the canonical authoring
  source for an individual lesson pack.
- **Export Diagnostics** is also separate. It exports local structured
  troubleshooting events, not lesson content or learner backup data.
- IndexedDB stores packs, settings, the active session, and SRS data in the
  current browser profile. Clearing site data or changing browser/profile can
  remove that local data, so use Learner Backup when moving learning state.

The complete production example bundled with the project is
[`src/data/starter-pack.json`](../src/data/starter-pack.json). The executable
schema is [`src/domain/lesson-pack.schema.ts`](../src/domain/lesson-pack.schema.ts);
if this guide and the executable schema ever differ, update this guide before
authoring or generating more content.
