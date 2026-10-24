import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 2000; // если разбор дольше - считаем, что парсер завис

// 1. Загружаем парсер. В html2json.js нет export, поэтому выполняем файл
//    в отдельном vm-контексте и потом вызываем html2json внутри него
const context = vm.createContext({});
const libPath = path.join(__dirname, 'html2json.js');
vm.runInContext(fs.readFileSync(libPath, 'utf8'), context, {
	filename: libPath
});

// 2. Вызов с таймаутом: vm прервет даже бесконечный цикл
function parse(html) {
	context.input = html;
	return vm.runInContext('html2json(input)', context, { timeout: TIMEOUT_MS });
}

// 3. Список примеров
const samplesDir = path.join(__dirname, 'html_samples');
const files = fs
	.readdirSync(samplesDir)
	.filter(f => f.endsWith('.html'))
	.sort();

if (files.length === 0) {
	console.error('В html_samples нет .html файлов');
	process.exit(1);
}

// 4. Прогоняем каждый файл
let failed = 0;

for (const file of files) {
	const html = fs.readFileSync(path.join(samplesDir, file), 'utf8');

	try {
		const result = parse(html);

		if (result?.type !== 'document') {
			throw new Error(
				`вернул не document, а ${JSON.stringify(result)?.slice(0, 80)}`
			);
		}

		JSON.stringify(result, null, 2); // упадет на циклических ссылках или очень глубоком дереве
		console.log(`OK    ${file}`);
	} catch (err) {
		failed++;
		const reason =
			err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
				? `завис: не закончил за ${TIMEOUT_MS} мс`
				: (err?.message ?? err);
		console.error(`FAIL  ${file}\n      ${reason}`);
	}
}

// 5. Итог. Код выхода 1, если что-то упало
console.log(`\n${files.length - failed}/${files.length} passed`);
process.exitCode = failed ? 1 : 0;
