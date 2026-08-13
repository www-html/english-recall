# Hướng dẫn thêm dữ liệu học

English Recall không dùng SQL hay backend. “Database bài học” là một file JSON
theo schema version 2. Sau khi import, ứng dụng kiểm tra file rồi lưu lesson pack
vào IndexedDB của trình duyệt.

## 1. Tạo file JSON

Tạo file, ví dụ `my-daily-english.json`:

```json
{
  "schemaVersion": 2,
  "id": "my-daily-english",
  "version": "1.0.0",
  "title": "My Daily English",
  "description": "Các câu tiếng Anh tôi dùng hằng ngày.",
  "sourceLanguage": "vi",
  "targetLanguage": "en-US",
  "lexemes": [
    {
      "id": "usually.adv.01",
      "text": "usually",
      "spokenText": "usually",
      "partOfSpeech": "adverb",
      "meaningVi": "thường"
    },
    {
      "id": "always.adv.01",
      "text": "always",
      "partOfSpeech": "adverb",
      "meaningVi": "luôn luôn"
    },
    {
      "id": "sometimes.adv.01",
      "text": "sometimes",
      "partOfSpeech": "adverb",
      "meaningVi": "thỉnh thoảng"
    },
    {
      "id": "rarely.adv.01",
      "text": "rarely",
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
              "distractorLexemeIds": [
                "always.adv.01",
                "sometimes.adv.01",
                "rarely.adv.01"
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Một pack cần ít nhất 4 lexemes vì mỗi target có 1 đáp án đúng và đúng 3
distractors. Nên chọn distractors cùng loại từ và hợp ngữ cảnh để bài tập có ý
nghĩa.

## 2. Tính `start` và `end`

`start` là vị trí ký tự đầu tiên; `end` là vị trí ngay sau ký tự cuối. Có thể
kiểm tra bằng Node.js hoặc DevTools:

```js
const text = 'I usually work from home.'
const word = 'usually'
const start = text.indexOf(word)
console.log({ start, end: start + word.length })
// { start: 2, end: 9 }
```

Chuỗi `displayText.slice(start, end)` phải trùng với `lexeme.text`, không phân
biệt chữ hoa/thường. Các target trong cùng câu không được chồng lên nhau và mỗi
câu hỗ trợ từ 1 đến 4 targets.

## 3. Dùng lại một từ trong nhiều ngữ cảnh

Không tạo lexeme mới cho mỗi câu. Giữ nguyên `lexemeId`, ví dụ
`usually.adv.01`, rồi tham chiếu nó từ nhiều sentences. Như vậy toàn bộ câu đều
cập nhật cùng một mastery/SRS record của từ “usually”.

## 4. Import vào ứng dụng

1. Mở Home.
2. Chọn **Import JSON**.
3. Chọn file JSON vừa tạo.
4. Khi thấy thông báo import thành công, lesson mới xuất hiện trong **Lesson
   library**.
5. Mở lesson và thử cả Word Choice, Fill Words và Listening Choice từ menu `⋮`.

Nếu schema, id, reference hoặc character span sai, ứng dụng từ chối toàn bộ file
và hiển thị lỗi. Không dùng id `english-recall-starter` cho pack riêng vì đó là
id của nội dung tích hợp sẵn.

## 5. Cập nhật và sao lưu

- Muốn cập nhật pack: giữ nguyên `id`, tăng `version`, rồi import lại. Pack cùng
  id sẽ được thay thế.
- Luôn giữ file JSON gốc làm bản sao lưu. Hiện ứng dụng chưa có chức năng export.
- IndexedDB lưu pack, settings, session đang học và SRS trên đúng browser/profile
  hiện tại. Xóa site data hoặc đổi browser/profile có thể làm mất dữ liệu local.

File mẫu đầy đủ đang dùng trong dự án là
[`src/data/starter-pack.json`](../src/data/starter-pack.json).
