# html2json

Original task: https://github.com/jito-dev/jito-intern-test-task

A small HTML to JSON converter in plain JavaScript, written without `DOMParser`
or any libraries. The whole parser lives in `html2json.js`, which is loaded in
`index.html` as a regular script (not a module).

## How to run

- **Demo:** open `index.html` in a browser, paste HTML and convert it. The
  result is shown as formatted JSON.
- **Tests:** `npm test`. There are no dependencies, so `npm install` is not
  needed. Requires Node.js 18 or newer.

## JSON format

Every node has a `type` field. There are five node types:

| type       | fields                          | notes                                                    |
| ---------- | ------------------------------- | -------------------------------------------------------- |
| `document` | `children`                      | the root, always returned                                |
| `element`  | `tag`, `attributes`, `children` | `tag` is lowercase, `attributes` is an object of strings |
| `text`     | `value`                         | entities are already decoded                             |
| `comment`  | `value`                         | text between `<!--` and `-->`                            |
| `doctype`  | `value`                         | e.g. `"html"`                                            |

If something throws inside the parser, `html2json` does not throw. It returns
`{ "type": "error", "message": "..." }` instead.

Example input:

```html
<!DOCTYPE html>
<div class="card">
	<p>Hello &amp; welcome</p>
	<!-- note -->
	<img src="a.png" alt="" />
</div>
```

Output:

```json
{
	"type": "document",
	"children": [
		{ "type": "doctype", "value": "html" },
		{
			"type": "element",
			"tag": "div",
			"attributes": { "class": "card" },
			"children": [
				{
					"type": "element",
					"tag": "p",
					"attributes": {},
					"children": [{ "type": "text", "value": "Hello & welcome" }]
				},
				{ "type": "comment", "value": " note " },
				{
					"type": "element",
					"tag": "img",
					"attributes": { "src": "a.png", "alt": "" },
					"children": []
				}
			]
		}
	]
}
```

## Why this format

- **One `type` field on every node.** Code that walks the tree can switch on it
  and never has to guess what a node is.
- **`children` is an array.** Order matters in HTML, and text, elements and
  comments can be mixed inside one parent.
- **`attributes` is an object.** Attribute names are unique (the first one wins
  on duplicates), order does not matter, and lookup by name is simple:
  `node.attributes.class`. Values are always strings. An attribute without a
  value, like `disabled`, gets `""`, the same as in the DOM.
- **Every element has `children`, even void ones** like `<img>`. All elements
  have the same shape, so there is no need to check whether the field exists.
- **Comments and doctype are kept.** They are part of the source, and dropping
  them would lose information.
- **Text nodes are merged.** Two text nodes never stand next to each other.

## How the parser works

`html2json(html)` does three things:

1. Prepares the input. Anything that is not a string becomes `""`, a leading BOM
   is removed, and `\r\n` and `\r` are replaced with `\n`.
2. `splitIntoTokens` walks the string once and turns it into a flat list of
   tokens: `startTag` (name, attributes, self-closing flag), `endTag`, `text`,
   `comment`, `doctype`.
3. `buildTree` turns the tokens into a tree using a stack of open elements:
   - **start tag:** first closes the elements it closes implicitly (see below),
     then adds the new element to the current parent and pushes it to the stack,
     unless it is a void element;
   - **end tag:** finds the nearest open element with the same name and closes
     it together with everything opened after it. An end tag with no matching
     open element is ignored;
   - **text, comment, doctype:** added to the current parent.

Elements that are still open when the input ends simply end there, nothing is
lost.

## What is handled

**Tags and attributes**

- Tag and attribute names are lowercased. Attribute values keep their case.
- Attribute values in double quotes, single quotes, without quotes, and
  attributes without a value.
- Duplicate attributes: the first one is kept.
- `>` inside a quoted attribute value does not end the tag
  (`<a title="a > b">`).
- Attributes and `/` inside end tags are ignored (`</div class="x">` closes
  `div`).
- `<` followed by a space, digit or other non-letter is treated as text
  (`1 < 2`). A closing tag without a letter after `</` (like `</3>`) is ignored.
- A tag cut off by the end of the input is dropped.

**Void and self-closing elements**

- `area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr`
  never get children.
- `/>` on a normal HTML element is ignored, as in browsers: `<div/>text` puts
  the text inside the `div`. Inside `<svg>` and `<math>`, `/>` does close the
  element.

**Raw text elements**

- The content of `script`, `style` and `textarea` is taken as text up to the
  matching end tag, even if it contains `<` or `</div>`.
- The end tag is matched in any case (`</SCRIPT>`), and `</scriptx>` does not
  close `script`.
- Without an end tag, the rest of the input becomes the text.
- Entities are decoded in `textarea`, but not in `script` and `style`.

**Implied end tags**

- `li` closes the previous `li`, `dt`/`dd` close each other, `option` closes the
  previous `option`, `optgroup` closes the previous `option` and `optgroup`,
  `td`/`th` close the previous cell, `tr` closes the previous row,
  `thead`/`tbody`/`tfoot` close each other.
- Block elements (`div`, `ul`, `table`, `h1`-`h6`, `section` and others) close
  an open `p`.
- The search for the element to close stops at a boundary, so `<li>` inside a
  nested list does not close the outer `li`, and a cell in a nested table does
  not close the outer cell.

**Entities**

- Numeric entities, decimal and hex (`&#65;`, `&#x41;`). Invalid code points,
  including values above `0x10FFFF`, become `U+FFFD`.
- 17 named entities:
  `amp, lt, gt, quot, apos, nbsp, copy, reg, trade, hellip, mdash, ndash, laquo, raquo, euro, middot, times`.
  Unknown entities stay as they are.
- Decoded in text and attribute values.

**Other**

- Comments, including a comment that is not closed until the end of the input.
- `<!DOCTYPE ...>` in any case. A doctype that appears after elements or inside
  an element is ignored.

## Decisions and limitations

These are deliberate simplifications compared to a browser:

- **No implied `html`, `head`, `body`, `tbody`.** The tree shows what is written
  in the source. A browser always creates these elements.
- **Indentation is removed.** A text node that contains only whitespace and at
  least one line break is treated as formatting and dropped. Whitespace inside
  `pre` and `textarea` is kept, and a single space between elements on one line
  (`<b>a</b> <i>b</i>`) is kept too. The cost: a line break between inline
  elements is lost, so `<a>Home</a>` and `<a>About</a>` on separate lines end up
  with no space between them, while a browser would show "Home About".
- **Only part of the named entities** (listed above), and only with a trailing
  `;`. `&copy` without `;` stays as text.
- **Maximum nesting depth is 512**, similar to Chrome. Elements below that depth
  are still added, but as flat children of the element at depth 512 instead of
  being nested further. Without this limit `JSON.stringify` fails on very deep
  input.
- **Not implemented:** the adoption agency algorithm for misnested formatting
  tags (`<b><i></b></i>`), moving stray content out of tables (foster
  parenting), quirks mode, a separate content fragment for `<template>`,
  restoring camelCase names in SVG (`viewBox` becomes `viewbox`).
- **Only `script`, `style` and `textarea` are raw text.** `title`, `xmp`,
  `iframe`, `noscript` and `plaintext` are parsed as normal HTML.
- `<![CDATA[...]]>` and other `<!...>` constructs that are not a doctype or a
  comment are dropped. `<?xml ...?>` ends up as text.
- If a quote in an attribute value is never closed, the tag ends at the first
  `>`. A browser would treat the rest of the input as part of the attribute.

## Tests

`test_samples.js` runs `html2json` on every `.html` file in `html_samples/`.
Each file covers one case: broken tags, attributes, entities, comments, raw
text, implied end tags, tables, SVG, very deep nesting, a large file and so on.

A file fails if the parser:

- throws an error;
- does not finish within 2 seconds (the parser runs in a separate `vm` context,
  so even an infinite loop is stopped);
- returns anything other than a `document` node (this includes the `error`
  node);
- returns a tree that `JSON.stringify(result, null, 2)` cannot serialize.

The tests check that the parser is robust, not that every tree is exactly right.
The trees are not compared with expected output automatically. What a browser
would build for each sample is described in `html_samples/README.md` and in a
comment at the top of each file.

## How I used AI

I used Claude while working on this task. The full chats are in `ai_help/`. It
helped with:

- generating the sample files in `html_samples/` and describing how a browser
  parses each of them;
- explaining parts of the code, for example the attribute regex;
- reviewing my code and finding bugs, for example an infinite loop on a tag that
  is not closed before the end of the input, `>` inside quoted attribute values,
  and implied end tags that only checked the top of the stack;
- suggesting fixes and the test script.

I went through the suggestions, added them to the code and checked the result
with the tests.
