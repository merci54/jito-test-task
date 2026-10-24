function convertHtml2JsonAndSet() {
	const htmlTextAreaValue = document.getElementById('html').value;
	const jsonObj = html2json(htmlTextAreaValue);
	const jsonArea = document.getElementById('json');
	jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
}

const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttributes(str) {
	const attributes = {};

	for (const match of str.matchAll(ATTR_RE)) {
		const name = match[1].toLowerCase();
		// при повторе атрибута браузер оставляет первый
		if (Object.hasOwn(attributes, name)) continue;
		// сработает только одна группа значения, если ни одна - атрибут без значения
		attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
	}

	return attributes;
}

// ищет ">", который закрывает тег, пропуская ">" внутри кавычек: <a title="x > y">
function findTagEnd(text, start) {
	let quote = null; // какая кавычка сейчас открыта: " или ', null - никакая
	let prev = ''; // предыдущий непробельный символ вне кавычек

	for (let i = start; i < text.length; i++) {
		const char = text[i];

		if (quote) {
			if (char === quote) quote = null; // кавычка закрылась
		} else if ((char === '"' || char === "'") && prev === '=') {
			quote = char; // кавычка открывает значение, только если стоит сразу после =
		} else if (char === '>') {
			return i; // ">" вне кавычек - конец тега
		}

		if (!quote && !/\s/.test(char)) prev = char;
	}

	// кавычка не закрылась до конца текста - берем первый ">"
	return text.indexOf('>', start);
}

const ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00A0',
	copy: '\u00A9',
	reg: '\u00AE',
	trade: '\u2122',
	hellip: '\u2026',
	mdash: '\u2014',
	ndash: '\u2013',
	laquo: '\u00AB',
	raquo: '\u00BB',
	euro: '\u20AC',
	middot: '\u00B7',
	times: '\u00D7'
};

function decodeEntities(str) {
	return str.replace(
		/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
		(match, entity) => {
			if (entity[0] === '#') {
				const isHex = entity[1] === 'x' || entity[1] === 'X';
				const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
				// fromCodePoint бросает RangeError на числах больше 0x10FFFF
				const valid =
					code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
				return valid ? String.fromCodePoint(code) : '\uFFFD';
			}
			return Object.hasOwn(ENTITIES, entity) ? ENTITIES[entity] : match;
		}
	);
}

const VOID_TAGS = [
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr'
];
const TEXT_TAGS = ['script', 'style', 'textarea'];

// какой открывающий тег закрывает какие уже открытые: <li> закрывает предыдущий <li>
// какой открывающий тег закрывает какие открытые элементы (close)
// и где поиск останавливается (stopAt), чтобы не закрыть внешний список или таблицу
const AUTO_CLOSE = {
	li: { close: ['li'], stopAt: ['ul', 'ol', 'menu'] },
	dt: { close: ['dt', 'dd'], stopAt: ['dl'] },
	dd: { close: ['dt', 'dd'], stopAt: ['dl'] },
	option: { close: ['option'], stopAt: ['select', 'datalist', 'optgroup'] },
	optgroup: { close: ['option', 'optgroup'], stopAt: ['select'] },
	tr: { close: ['tr'], stopAt: ['table', 'thead', 'tbody', 'tfoot'] },
	td: { close: ['td', 'th'], stopAt: ['tr', 'table'] },
	th: { close: ['td', 'th'], stopAt: ['tr', 'table'] },
	thead: { close: ['thead', 'tbody', 'tfoot'], stopAt: ['table'] },
	tbody: { close: ['thead', 'tbody', 'tfoot'], stopAt: ['table'] },
	tfoot: { close: ['thead', 'tbody', 'tfoot'], stopAt: ['table'] }
};

// блочные теги, которые закрывают открытый <p>
const P_CLOSERS = [
	'p',
	'div',
	'ul',
	'ol',
	'dl',
	'table',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'section',
	'article',
	'header',
	'footer',
	'nav',
	'main',
	'aside',
	'form',
	'pre',
	'blockquote',
	'hr',
	'figure',
	'address',
	'details',
	'dialog',
	'fieldset',
	'figcaption',
	'hgroup',
	'menu',
	'search',
	'summary',
	'li',
	'dd',
	'dt'
];
const P_STOP_AT = [
	'button',
	'table',
	'td',
	'th',
	'caption',
	'template',
	'svg',
	'math'
];
const MAX_DEPTH = 512; // как в Chrome, иначе JSON.stringify падает на очень глубоком HTML

// идем вниз по стеку до границы и закрываем самый нижний подходящий элемент
// вместе со всем, что открыто над ним
function closeImplied(stack, close, stopAt) {
	let cut = -1;
	for (let j = stack.length - 1; j > 0; j--) {
		const tag = stack[j].tag;
		if (stopAt.includes(tag)) break;
		if (close.includes(tag)) cut = j;
	}
	if (cut !== -1) stack.length = cut;
}

function splitIntoTokens(text) {
	const tokens = [];
	let i = 0;

	while (i < text.length) {
		if (text.startsWith('<!--', i)) {
			// если омментарий до "-->",
			// а если его нет - до конца текста

			let end = text.indexOf('-->', i + 4);
			if (end === -1) end = text.length;
			tokens.push({ type: 'comment', value: text.slice(i + 4, end) });
			i = end + 3;
		} else if (text.startsWith('<!', i)) {
			// <!DOCTYPE html>

			let end = text.indexOf('>', i);
			if (end === -1) end = text.length;
			const content = text.slice(i + 2, end).trim();
			if (content.toLowerCase().startsWith('doctype')) {
				tokens.push({ type: 'doctype', value: content.slice(7).trim() });
			}
			i = end + 1;
		} else if (text.startsWith('</', i)) {
			const end = text.indexOf('>', i);
			// тег оборван концом файла - браузер его отбрасывает
			if (end === -1) break;
			const name = text
				.slice(i + 2, end)
				.match(/^[^\s\/>]*/)[0]
				.toLowerCase();
			tokens.push({ type: 'endTag', name });
			i = end + 1;
		} else if (text[i] === '<' && /[a-zA-Z]/.test(text[i + 1] || '')) {
			const end = findTagEnd(text, i);

			// тег оборван концом файла - браузер его отбрасывает
			if (end === -1) break;
			const inside = text.slice(i + 1, end);

			const nameMatch = inside.match(/^[^\s\/>]+/);
			const name = nameMatch ? nameMatch[0].toLowerCase() : '';

			// всё, что после имени, это атрибуты
			const attributes = parseAttributes(
				inside.slice(nameMatch ? nameMatch[0].length : 0)
			);

			const selfClosing = /\/\s*$/.test(inside);
			tokens.push({ type: 'startTag', name, attributes, selfClosing });
			i = end + 1;

			if (TEXT_TAGS.includes(name)) {
				// ищем </name, за которым идет пробел, "/" или ">", в любом регистре
				const closeRe = new RegExp(`</${name}[\\s/>]`, 'gi');
				closeRe.lastIndex = i; // искать с позиции сразу после открывающего тега
				const match = closeRe.exec(text);

				// нет закрывающего тега - текст до конца строки
				const textEnd = match ? match.index : text.length;
				if (textEnd > i) {
					const raw = text.slice(i, textEnd);
					tokens.push({
						type: 'text',
						value: name === 'textarea' ? decodeEntities(raw) : raw
					});
				}
				// сам закрывающий тег не трогаем: на следующем шаге цикла
				// его разберет обычная ветка '</'
				i = textEnd;
			}
		} else {
			let end = text.indexOf('<', i + 1);
			if (end === -1) end = text.length;
			tokens.push({ type: 'text', value: decodeEntities(text.slice(i, end)) });
			i = end;
		}
	}

	return tokens;
}

function buildTree(tokens) {
	const root = { type: 'document', children: [] };
	const stack = [root];

	for (const token of tokens) {
		if (token.type === 'startTag') {
			if (P_CLOSERS.includes(token.name)) closeImplied(stack, ['p'], P_STOP_AT);
			// Object.hasOwn, а не AUTO_CLOSE[name]: иначе тег <constructor> найдет встроенное свойство объекта
			const rule = Object.hasOwn(AUTO_CLOSE, token.name)
				? AUTO_CLOSE[token.name]
				: null;
			if (rule) closeImplied(stack, rule.close, rule.stopAt);
		}

		// родителя берем только после автозакрытия
		const parent = stack[stack.length - 1];

		if (token.type === 'startTag') {
			const element = {
				type: 'element',
				tag: token.name,
				attributes: token.attributes,
				children: []
			};
			parent.children.push(element);

			const inForeign =
				token.name === 'svg' ||
				token.name === 'math' ||
				stack.some(el => el.tag === 'svg' || el.tag === 'math');
			const closed =
				VOID_TAGS.includes(token.name) || (inForeign && token.selfClosing);
			if (!closed && stack.length < MAX_DEPTH) stack.push(element);
		} else if (token.type === 'endTag') {
			const index = stack.findLastIndex(element => element.tag === token.name);
			if (index > 0) stack.length = index;
		} else if (token.type === 'text') {
			// пробельный текст с переносом строки - это отступы в коде, их выбрасываем.
			// одиночный пробел между словами оставляем, внутри <pre> и <textarea> не трогаем ничего
			const isIndent =
				/^[ \t\n\r\f]*$/.test(token.value) && token.value.includes('\n');
			const keepsSpaces = stack.some(
				el => el.tag === 'pre' || el.tag === 'textarea'
			);
			if (isIndent && !keepsSpaces) continue;
			const last = parent.children[parent.children.length - 1];
			if (last && last.type === 'text') last.value += token.value;
			else parent.children.push({ type: 'text', value: token.value });
		} else if (token.type === 'doctype') {
			// doctype имеет смысл только в начале документа, повторный браузер игнорирует
			const hasElements = root.children.some(node => node.type === 'element');
			if (stack.length === 1 && !hasElements) root.children.push(token);
		} else {
			// комментарий
			parent.children.push(token);
		}
	}

	return root;
}

function html2json(htmlText) {
	try {
		const text = typeof htmlText === 'string' ? htmlText : '';
		const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
		return buildTree(splitIntoTokens(normalized));
	} catch (error) {
		return { type: 'error', message: error.message };
	}
}

function showExample1() {
	const htmlExample = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
    </header>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the webpage.</p>
        </section>
        <section id="about">
            <h2>About Section</h2>
            <p>This is the about section of the webpage.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 My Website</p>
    </footer>
    <script src="script.js"></script>
</body>
</html>
`;
	const jsonContent = {
		'Comment 1':
			'You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.',
		'Comment 2':
			'When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.'
	};

	document.getElementById('html').value = htmlExample;
	document.getElementById('json').textContent = JSON.stringify(
		jsonContent,
		null,
		2
	);
}

function showExample2() {
	const htmlExample = `<div>
<p>Hello world!</p>
  <button>Click me!</button>
  <textarea>Some very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very long string.</textarea>
</div>
`;
	const jsonContent = {
		'Comment 1':
			'You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.',
		'Comment 2':
			'When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.'
	};

	document.getElementById('html').value = htmlExample;
	document.getElementById('json').textContent = JSON.stringify(
		jsonContent,
		null,
		2
	);
}
