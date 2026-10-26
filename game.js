'use strict';
/* 百衲被：界面、操作、存档、分享。出题和判定在 logic.js（window.Quilt）。 */
(function () {
	const Q = window.Quilt;
	const LEVELS = Q.LEVELS;
	const EPOCH_KEY = '2026-10-25'; // 第 1 床的日期
	const STORE_KEY = 'quilt-v4';
	const NAME_COUNT = 144;
	const NAME_STRIDE = 37; // 和 144 互质，按天号轮到不重名
	const LEVEL_LIMIT = { hint: 1, undo: 1 }; // 每关各一次，重来后补满
	const NO_PROPS_USED = { hint: 0, undo: 0 };
	const FREE_LEVELS = 2; // 新手、热身两关道具随便用
	const COUNTS_AS_DAY = 2; // 缝完第 3 关「入门」（下标 2）就算今天缝过
	/** 新手关每一步的讲解，跟着「先点这块 / 再点这块」走。 */
	const TUTORIAL = [
		'两块布挨着的那半边，颜色和形状一样就能缝上。先点写着「先点这块」的布',
		'米色带虚线的边是被子外沿，要朝外放。再换一次',
		'最后一步！换完所有接缝就都对上了',
	];
	const CELEBRATE_MS = 2400;
	const CABINET_MAX = 30;
	const SEAM_INSET = 16;
	// 格子小（5×5、6×6）时针脚和提示线不能跟着缩没了：屏幕像素下限
	const LINE_MIN_PX = { hintUnder: 9, hint: 4.5 };
	const DEBUG_HOSTS = ['localhost', '127.0.0.1'];
	const NUM_MARK = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
	const LEVEL_WORD = `${'零一二三四五六七'[LEVELS.length]}关`;

	/**
	 * 花纹：颜色 + 形状，分不清颜色也能靠形状对。
	 * 颜色用旧棉布那种柔和的色，色弱也能分开（拉开明度）；形状用同色系浅一档（tint），满盘 6×6 不再是一块块亮白。
	 */
	const PATTERNS = {
		1: { color: '#A9503A', tint: '#E4C5B6', shape: 'circle' },
		2: { color: '#DDA94A', tint: '#8C5F1E', shape: 'square' }, // 黄底太亮，浅色形状看不出，用深一档
		3: { color: '#36597D', tint: '#C4C8C9', shape: 'diamond' },
		4: { color: '#7FA37A', tint: '#D8DDC8', shape: 'star' },
		5: { color: '#9C7397', tint: '#E0CFD0', shape: 'plus' },
	};
	const SHAPE_SCALE = 0.9; // 形状缩小一些，留出更多布面
	const BORDER_FILL = '#EFE5D4';
	const BORDER_STITCH = '#B8A589';
	const SHAPE_EDGE = 'rgba(58,46,36,.65)'; // 小屏上绿星、黄方靠这道描边认出来
	const NAME_A = ['外婆的', '秋日', '雨后', '灯下', '小院', '晨光', '山间', '年夜', '村口', '窗边', '午后', '老屋'];
	const NAME_B = ['牡丹', '石榴', '格子', '星星', '麦田', '梅花', '风车', '橘子', '荷塘', '燕子', '柿子', '月亮'];
	const TIP_CORNER = '从四个角开始拼：两道米色外沿的布放角上';
	const TIPS = [
		'缝线对上不一定放对了，要看四边',
		'先把被子的外圈拼好，中间就好办了',
		'哪块布只能放一个地方？先放它',
		'卡住了就挑一处，先放一块试试',
	];

	const $ = id => document.getElementById(id);
	const board = $('board');

	// ---------- 日期 ----------
	function dateKey(d) {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function parseKey(key) {
		const [y, m, d] = key.split('-').map(Number);
		return new Date(y, m - 1, d);
	}
	function isValidKey(key) {
		return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && dateKey(parseKey(key)) === key;
	}
	/** 本机调试时可以用 ?date= 指定日期；发出去的网址上不生效，也不能早于第 1 床。 */
	function todayKey() {
		const real = dateKey(new Date());
		if (!DEBUG_HOSTS.includes(location.hostname)) return real;
		const forced = new URLSearchParams(location.search).get('date');
		return isValidKey(forced) && forced >= EPOCH_KEY ? forced : real;
	}
	function shiftKey(key, days) {
		const d = parseKey(key);
		return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
	}
	function dayNumber(key) {
		const a = parseKey(key), b = parseKey(EPOCH_KEY);
		return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000) + 1;
	}
	function nameForDay(num) {
		const idx = (((num - 1) * NAME_STRIDE) % NAME_COUNT + NAME_COUNT) % NAME_COUNT;
		return NAME_A[Math.floor(idx / NAME_B.length)] + NAME_B[idx % NAME_B.length];
	}
	function randomName() {
		return NAME_A[Math.floor(Math.random() * NAME_A.length)] + NAME_B[Math.floor(Math.random() * NAME_B.length)];
	}

	const puzzleCache = new Map();
	function levelPuzzle(key, level) {
		const id = `${key}#${level}`;
		if (!puzzleCache.has(id)) puzzleCache.set(id, Q.makePuzzle(`quilt-${key}-L${level}`, LEVELS[level]));
		return puzzleCache.get(id);
	}

	// ---------- 存档：读时逐项校验，写时先和磁盘上的合并，避免两个标签页互相覆盖 ----------
	const EMPTY = { streak: 0, best: 0, last: null, days: {}, dayProps: null, progress: null, sound: true, seenHelp: false };
	const isInt = (x, lo = 0) => Number.isInteger(x) && x >= lo;

	function cleanLevel(l) {
		if (!l || typeof l !== 'object' || !isInt(l.steps) || !isInt(l.min) || ![1, 2, 3].includes(l.stars)) return null;
		return { steps: l.steps, min: l.min, stars: l.stars, gold: l.gold === true, restarts: isInt(l.restarts) ? l.restarts : 0 };
	}

	function cleanDay(d) {
		if (!d || typeof d !== 'object' || !d.levels || typeof d.levels !== 'object') return null;
		const levels = {};
		for (let i = 0; i < LEVELS.length; i++) {
			const l = cleanLevel(d.levels[i]);
			if (l) levels[i] = l;
		}
		return Object.keys(levels).length ? { levels } : null;
	}

	function cleanProps(p) {
		if (!p || !isValidKey(p.date)) return null;
		return { date: p.date, hint: isInt(p.hint) ? p.hint : 0, undo: isInt(p.undo) ? p.undo : 0 };
	}

	function cleanStore(raw) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY };
		const days = {};
		if (raw.days && typeof raw.days === 'object') {
			for (const [k, v] of Object.entries(raw.days)) {
				const d = isValidKey(k) ? cleanDay(v) : null;
				if (d) days[k] = d;
			}
		}
		const p = raw.progress;
		return {
			streak: isInt(raw.streak) ? raw.streak : 0,
			best: isInt(raw.best) ? raw.best : 0,
			last: isValidKey(raw.last) && raw.last <= todayKey() ? raw.last : null,
			days,
			dayProps: cleanProps(raw.dayProps),
			progress: p && typeof p === 'object' && isValidKey(p.date) && isInt(p.level) && p.level < LEVELS.length ? p : null,
			sound: raw.sound !== false,
			seenHelp: raw.seenHelp === true,
		};
	}

	function readDisk() {
		try {
			const raw = localStorage.getItem(STORE_KEY);
			return cleanStore(raw ? JSON.parse(raw) : null);
		} catch {
			return { ...EMPTY };
		}
	}

	function mergeDays(a, b) {
		const out = { ...a };
		for (const [k, d] of Object.entries(b)) out[k] = out[k] ? { levels: { ...d.levels, ...out[k].levels } } : d;
		return out;
	}

	/** 同一天的进度：关数高的优先，同一关取步数多的那份。 */
	function pickProgress(a, b) {
		if (!a) return b;
		if (!b) return a;
		if (a.date !== b.date) return a.date > b.date ? a : b;
		if (a.level !== b.level) return a.level > b.level ? a : b;
		return (b.steps || 0) > (a.steps || 0) ? b : a;
	}

	function pickProps(a, b) {
		if (!a) return b;
		if (!b) return a;
		if (a.date !== b.date) return a.date > b.date ? a : b;
		return { date: a.date, hint: Math.max(a.hint, b.hint), undo: Math.max(a.undo, b.undo) };
	}

	/** 两份存档合并：完成记录只增不删，连缝取日期更晚的那份，道具次数取用得多的。 */
	function mergeStores(disk, mine) {
		const newer = (disk.last || '') > (mine.last || '') ? disk : mine;
		const streak = disk.last === mine.last ? Math.max(disk.streak, mine.streak) : newer.streak;
		return {
			...mine,
			days: mergeDays(mine.days, disk.days),
			last: newer.last,
			streak,
			best: Math.max(disk.best, mine.best, streak),
			dayProps: pickProps(disk.dayProps, mine.dayProps),
			progress: pickProgress(disk.progress, mine.progress),
			seenHelp: disk.seenHelp || mine.seenHelp,
		};
	}

	let store = readDisk();
	/** patch.progress 是本页刚走的一步，直接以本页为准，不和磁盘比步数。 */
	function saveStore(patch) {
		const merged = mergeStores(readDisk(), { ...store, ...patch });
		store = 'progress' in patch ? { ...merged, progress: patch.progress } : merged;
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(store));
		} catch {
			/* 无痕模式等存不了，游戏照常玩 */
		}
	}

	function dayLevels(key) {
		return (store.days[key] && store.days[key].levels) || {};
	}
	function nextLevel(key) {
		const done = dayLevels(key);
		for (let i = 0; i < LEVELS.length; i++) if (!done[i]) return i;
		return null;
	}
	function usedProps(key) {
		const p = store.dayProps;
		return p && p.date === key ? p : { date: key, hint: 0, undo: 0 };
	}

	// ---------- 画布块 ----------
	const SVG_NS = 'http://www.w3.org/2000/svg';
	const SIDES = [
		{ tri: '0,0 100,0 50,50', mid: [50, 0], stitch: [8, 6, 92, 6] },
		{ tri: '100,0 100,100 50,50', mid: [100, 50], stitch: [94, 8, 94, 92] },
		{ tri: '100,100 0,100 50,50', mid: [50, 100], stitch: [8, 94, 92, 94] },
		{ tri: '0,100 0,0 50,50', mid: [0, 50], stitch: [6, 8, 6, 92] },
	];

	function shapeSvg(pattern, [x, y]) {
		const fill = `fill="${pattern.tint}" stroke="${SHAPE_EDGE}" stroke-width="1.5" transform="translate(${x} ${y}) scale(${SHAPE_SCALE}) translate(${-x} ${-y})"`;
		switch (pattern.shape) {
			case 'circle': return `<circle cx="${x}" cy="${y}" r="16" ${fill}/>`;
			case 'square': return `<rect x="${x - 13}" y="${y - 13}" width="26" height="26" ${fill}/>`;
			case 'diamond': return `<polygon points="${x},${y - 18} ${x + 18},${y} ${x},${y + 18} ${x - 18},${y}" ${fill}/>`;
			case 'star': return `<path d="M${x},${y - 20}L${x + 6},${y - 6}L${x + 20},${y}L${x + 6},${y + 6}L${x},${y + 20}L${x - 6},${y + 6}L${x - 20},${y}L${x - 6},${y - 6}z" ${fill}/>`;
			case 'plus': return `<path d="M${x - 5},${y - 17}h10v12h12v10h-12v12h-10v-12h-12v-10h12z" ${fill}/>`;
			default: return '';
		}
	}

	/** 一块布：四个三角，每个三角是一边的花纹；外沿是米色带缝线。 */
	function tileSvgInner(tile) {
		let out = '';
		tile.forEach((p, side) => {
			out += `<polygon points="${SIDES[side].tri}" fill="${p === Q.BORDER ? BORDER_FILL : PATTERNS[p].color}"/>`;
		});
		tile.forEach((p, side) => {
			const s = SIDES[side];
			if (p === Q.BORDER) {
				const [x1, y1, x2, y2] = s.stitch;
				out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${BORDER_STITCH}" stroke-width="2.4" stroke-dasharray="5 4"/>`;
			} else {
				out += shapeSvg(PATTERNS[p], s.mid);
			}
		});
		out += '<path d="M0,0 L100,100 M100,0 L0,100" stroke="rgba(40,25,10,.10)" stroke-width="1"/>';
		return out;
	}

	function tileSvg(tile) {
		return `<svg viewBox="0 0 100 100" aria-hidden="true">${tileSvgInner(tile)}</svg>`;
	}

	/** 把一组布块按 cols 列排成一张图（被柜小图、玩法示意图共用）。 */
	function tilesSvg(tiles, cols, seams = []) {
		const rows = Math.ceil(tiles.length / cols);
		let out = `<svg viewBox="0 0 ${cols * 100} ${rows * 100}" aria-hidden="true">`;
		tiles.forEach((tile, i) => {
			out += `<g transform="translate(${(i % cols) * 100},${Math.floor(i / cols) * 100})">${tileSvgInner(tile)}</g>`;
		});
		seams.forEach(([x1, y1, x2, y2]) => {
			const xy = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`;
			out += `<line ${xy} stroke="#FFF8EC" stroke-width="9" stroke-linecap="round" opacity=".85"/>`;
			out += `<line ${xy} stroke="#5B3A22" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 6"/>`;
		});
		return out + '</svg>';
	}

	// ---------- 声音（iOS 要在第一次触摸时解锁） ----------
	let audio = null;
	function ensureAudio() {
		if (!store.sound) return null;
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return null;
		if (!audio) audio = new AC();
		if (audio.state === 'suspended') audio.resume();
		return audio;
	}
	function tone(freq, dur, type, gain, delay = 0) {
		const ctx = ensureAudio();
		if (!ctx) return;
		const t = ctx.currentTime + delay;
		const osc = ctx.createOscillator();
		const g = ctx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t);
		g.gain.setValueAtTime(gain, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(g).connect(ctx.destination);
		osc.start(t);
		osc.stop(t + dur + 0.02);
	}
	const sound = {
		tap: () => tone(700, 0.05, 'triangle', 0.08),
		swap: () => { tone(420, 0.08, 'triangle', 0.16); tone(210, 0.1, 'sine', 0.12); },
		sew: k => tone(660 * Math.pow(1.04, Math.min(k, 20)), 0.22, 'sine', 0.09, 0.12),
		star: i => tone([784, 988, 1175][i] || 1175, 0.35, 'sine', 0.13),
		win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, 'sine', 0.12, 0.1 + i * 0.12)),
	};
	function buzz(pattern) {
		if (navigator.vibrate) navigator.vibrate(pattern);
	}

	// ---------- 游戏状态 ----------
	// game.mode：daily 今日关卡 / practice 练习
	let game = null;
	let selected = null;
	let drag = null; // { id, tile, over }
	let tileEls = [];
	let guide = null; // 新手引导：要换的两块布（布块编号）
	const timers = new Set();

	function later(fn, ms) {
		const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
		timers.add(id);
	}
	function clearTimers() {
		timers.forEach(clearTimeout);
		timers.clear();
	}
	function anyDialogOpen() {
		return !!document.querySelector('dialog[open]');
	}

	function newGame(fields) {
		const size = fields.puzzle.n * fields.puzzle.n;
		return {
			perm: fields.puzzle.start, steps: 0, moves: new Array(size).fill(0), history: [], hinted: [],
			levelProps: 0, propsUsed: NO_PROPS_USED, restarts: 0, done: false, ...fields,
		};
	}

	function startDaily() {
		const key = todayKey();
		const next = nextLevel(key);
		playLevel(key, next === null ? LEVELS.length - 1 : next);
	}

	function validTilePair(pair, size) {
		return Array.isArray(pair) && pair.length === 2 && pair.every(t => isInt(t) && t < size);
	}

	function playLevel(key, level) {
		const puzzle = levelPuzzle(key, level);
		const num = dayNumber(key);
		const size = puzzle.n * puzzle.n;
		const record = dayLevels(key)[level];
		let g = newGame({ mode: 'daily', key, num, level, name: nameForDay(num), spec: LEVELS[level], puzzle });
		if (record) {
			g = { ...g, perm: [...Array(size).keys()], steps: record.steps, done: true, record };
		} else {
			const p = store.progress;
			if (p && p.date === key && p.level === level && Q.isPermutation(p.perm, size) && isInt(p.steps)) {
				const prev = p.prev && Q.isPermutation(p.prev.perm, size) && validTilePair(p.prev.tiles, size) ? p.prev : null;
				g = {
					...g,
					perm: p.perm,
					steps: p.steps,
					moves: Array.isArray(p.moves) && p.moves.length === size && p.moves.every(x => isInt(x)) ? p.moves : g.moves,
					history: prev ? [prev] : [],
					hinted: validTilePair(p.hinted, size) ? p.hinted : [],
					levelProps: isInt(p.levelProps) ? p.levelProps : 0,
					propsUsed: p.propsUsed && isInt(p.propsUsed.hint) && isInt(p.propsUsed.undo) ? p.propsUsed : NO_PROPS_USED,
					restarts: isInt(p.restarts) ? p.restarts : 0,
				};
			}
		}
		show(g);
		if (game.done) {
			board.classList.add('done');
			setHint(nextLevel(key) === null ? `今天${LEVEL_WORD}全缝完了，明天再来` : '这一关缝好了');
			return;
		}
		if (Q.isSolved(game.perm)) {
			finish();
			return;
		}
		// 从没缝完过任何一关的新玩家：新手关每一步都带着点
		if (level === 0 && !Object.keys(store.days).length) {
			game = { ...game, tutorial: true };
			startGuide();
		}
	}

	function startPractice(level) {
		const puzzle = Q.makePuzzle(`practice-${Date.now()}-${Math.random()}`, LEVELS[level]);
		show(newGame({ mode: 'practice', key: null, num: null, level, name: randomName(), spec: LEVELS[level], puzzle }));
		setHint(`练习 · ${LEVELS[level].label}，不计入成绩`);
	}

	/** 新手引导：挑一对换完能新缝上最多道线的布，让第一步就看到「缝上了」。 */
	function startGuide(prefix = '') {
		const { tiles, n } = game.puzzle;
		const base = Q.matchedSeams(tiles, game.perm, n).length;
		let best = null;
		game.perm.forEach((t, pos) => {
			if (t === pos) return;
			const j = game.perm.indexOf(pos);
			const gain = Q.matchedSeams(tiles, Q.applySwap(game.perm, pos, j), n).length - base;
			if (!best || gain > best.gain) best = { gain, pair: [game.perm[pos], game.perm[j]] };
		});
		guide = best ? best.pair : null;
		renderGuide(prefix);
	}

	function tutorialText() {
		return TUTORIAL[Math.min(game.steps, TUTORIAL.length - 1)];
	}

	// ---------- 渲染 ----------
	function show(g) {
		clearTimers();
		closeDialog('dlg-win');
		game = g;
		selected = null;
		drag = null;
		guide = null;
		const n = g.puzzle.n;
		window.scrollTo(0, 0);
		board.classList.remove('done');
		$('banner').classList.remove('show');
		board.innerHTML = '';
		const inner = document.createElement('div');
		inner.className = 'board-inner';
		inner.style.setProperty('--size', `${100 / n}%`);
		tileEls = g.puzzle.tiles.map((tile, t) => {
			const el = document.createElement('div');
			el.className = 'tile';
			el.dataset.t = String(t);
			el.tabIndex = 0;
			el.setAttribute('role', 'button');
			el.innerHTML = tileSvg(tile);
			inner.appendChild(el);
			return el;
		});
		const seams = document.createElementNS(SVG_NS, 'svg');
		seams.setAttribute('class', 'seams');
		seams.setAttribute('viewBox', `0 0 ${n * 100} ${n * 100}`);
		seams.setAttribute('preserveAspectRatio', 'none');
		inner.appendChild(seams);
		const hintLayer = document.createElementNS(SVG_NS, 'svg');
		hintLayer.setAttribute('class', 'hint-layer');
		hintLayer.setAttribute('viewBox', `0 0 ${n * 100} ${n * 100}`);
		hintLayer.setAttribute('preserveAspectRatio', 'none');
		inner.appendChild(hintLayer);
		board.appendChild(inner);
		placeTiles();
		renderHinted();
		renderSeams(new Set(), false);
		renderHeader();
		renderLevels();
		renderStats(false);
		renderProps();
		renderBottom();
		setHint(g.level === 0 ? '新手关：三步就能缝好'
			: g.level === 1 ? '热身：这次自己来，先找四个角'
				: `第 ${g.level + 1} 关 · ${g.spec.label}：${g.puzzle.n * g.puzzle.n} 块布`);
	}

	function renderHeader() {
		const g = game;
		$('subtitle').textContent = g.mode === 'daily' ? `第 ${g.num} 床 · ${g.name}` : `练习 · ${g.name}`;
		const min = g.puzzle.min;
		$('goal').innerHTML = `三星 ≤ <strong>${min + g.spec.stars[0]}</strong> 步 · 金针 <strong>${min}</strong> 步`;
	}

	function levelBadge(rec) {
		if (!rec) return '';
		return rec.gold ? '金针' : '★'.repeat(rec.stars);
	}

	function renderLevels() {
		const nav = $('levels');
		const key = game.mode === 'daily' ? game.key : todayKey();
		const done = dayLevels(key);
		const next = nextLevel(key);
		nav.innerHTML = LEVELS.map((L, i) => {
			const rec = done[i];
			const open = rec || i === next;
			const cls = ['level-chip', rec ? 'cleared' : '', rec && rec.gold ? 'gold' : '', game.mode === 'daily' && game.level === i ? 'current' : '', i === LEVELS.length - 1 ? 'hardest' : ''].join(' ');
			const sub = rec ? levelBadge(rec) : (open || i === LEVELS.length - 1 ? L.label : '🔒');
			return `<button class="${cls}" data-level="${i}" ${open ? '' : 'disabled'} aria-label="第 ${i + 1} 关 ${L.label}">${i + 1}<small>${sub}</small></button>`;
		}).join('');
	}

	function placeTiles() {
		const n = game.puzzle.n;
		game.perm.forEach((t, pos) => {
			const el = tileEls[t];
			const r = Math.floor(pos / n), c = pos % n;
			el.style.setProperty('--x', String(c));
			el.style.setProperty('--y', String(r));
			el.setAttribute('aria-label', `第 ${r + 1} 行第 ${c + 1} 列的布`);
		});
	}

	/** 提示：两块布粗框跳动 + 贴「① 换」「② 换」+ 中间一条流动虚线连起来（线压在两块布下面，不挡标签）。 */
	function renderHinted() {
		tileEls.forEach((el, t) => {
			el.classList.toggle('hinted', game.hinted.includes(t));
			el.querySelector('.hint-tag')?.remove();
		});
		const layer = board.querySelector('.hint-layer');
		if (!layer) return;
		if (game.hinted.length !== 2 || game.done) {
			layer.innerHTML = '';
			return;
		}
		const n = game.puzzle.n;
		const centers = game.hinted.map((t, k) => {
			const tag = document.createElement('span');
			tag.className = 'tag hint-tag';
			tag.textContent = k === 0 ? '① 换' : '② 换';
			tileEls[t].appendChild(tag);
			const pos = game.perm.indexOf(t);
			return [(pos % n) * 100 + 50, Math.floor(pos / n) * 100 + 50];
		});
		const [[x1, y1], [x2, y2]] = centers;
		layer.innerHTML = `<line class="hint-link-bg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
			+ `<line class="hint-link" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
	}

	function seamKey(s) {
		return `${s.dir}${s.r}-${s.c}`;
	}

	/** 按棋盘实际大小设提示线宽下限（SVG 单位：每格 100）。 */
	function updateLineScale() {
		const inner = board.querySelector('.board-inner');
		if (!inner || !game || !inner.clientWidth) return;
		const n = game.puzzle.n;
		const px = inner.clientWidth / (n * 100); // 一个 SVG 单位多少像素
		const unit = (base, minPx) => Math.max(base, minPx / px).toFixed(2);
		const vars = {
			'--hint-under': unit(12, LINE_MIN_PX.hintUnder),
			'--hint-w': unit(6, LINE_MIN_PX.hint),
		};
		Object.entries(vars).forEach(([k, v]) => inner.style.setProperty(k, v));
	}

	/** 四边里该缝的接缝全都缝上了的布（外沿那边不算）。 */
	function placedTiles(list, n) {
		const sewn = new Array(n * n).fill(0);
		list.forEach(s => {
			sewn[s.r * n + s.c] += 1;
			sewn[s.dir === 'h' ? s.r * n + s.c + 1 : (s.r + 1) * n + s.c] += 1;
		});
		const set = new Set();
		game.perm.forEach((tile, pos) => {
			const r = Math.floor(pos / n), c = pos % n;
			const need = (r > 0) + (r < n - 1) + (c > 0) + (c < n - 1);
			if (sewn[pos] === need) set.add(tile);
		});
		return set;
	}

	/** 画已对上的接缝；新缝上的那几道带缝线动画。返回这次新缝上的数量。 */
	function renderSeams(before, animate) {
		const n = game.puzzle.n;
		const list = Q.matchedSeams(game.puzzle.tiles, game.perm, n);
		updateLineScale();
		const placed = placedTiles(list, n);
		tileEls.forEach((el, t) => el.classList.toggle('placed', placed.has(t)));
		const svg = board.querySelector('.seams');
		const fresh = [];
		// 每道缝：白色衬底 + 深色针脚，任何颜色的布上都看得清；刚缝上的再弹一圈金光
		svg.innerHTML = list.map(s => {
			const isNew = animate && !before.has(seamKey(s));
			const [x1, y1, x2, y2] = s.dir === 'h'
				? [(s.c + 1) * 100, s.r * 100 + SEAM_INSET, (s.c + 1) * 100, (s.r + 1) * 100 - SEAM_INSET]
				: [s.c * 100 + SEAM_INSET, (s.r + 1) * 100, (s.c + 1) * 100 - SEAM_INSET, (s.r + 1) * 100];
			const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
			if (isNew) fresh.push(mid);
			const xy = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`;
			const nw = isNew ? ' new' : '';
			return `<line class="seam-bg${nw}" ${xy}/><line class="seam${nw}" ${xy}/>`
				+ (isNew ? `<circle class="seam-pop" cx="${mid[0]}" cy="${mid[1]}" r="30"/>` : '');
		}).join('');
		showSewnLabels(fresh, n);
		game.seamSet = new Set(list.map(seamKey));
		const total = Q.seamTotal(n);
		$('progress-fill').style.width = `${(list.length / total) * 100}%`;
		$('seam-count').textContent = `已缝 ${list.length}/${total} 道`;
		return fresh.length;
	}

	/** 在刚缝上的接缝旁飘出「缝上了 ✓」，一眼看出这一步缝上了哪几道。 */
	function showSewnLabels(points, n) {
		const inner = board.querySelector('.board-inner');
		inner.querySelectorAll('.seam-label').forEach(el => el.remove());
		// 一步缝上好几道时错开飘出；5×5、6×6 格子小，只飘 ✓，免得叠在一起盖住布
		points.forEach(([x, y], i) => {
			const el = document.createElement('span');
			el.className = 'seam-label';
			el.textContent = n >= 5 ? '✓' : '缝上了 ✓';
			el.style.animationDelay = `${i * 110}ms`;
			el.style.left = `${x / n}%`;
			el.style.top = `${y / n}%`;
			inner.appendChild(el);
			setTimeout(() => el.remove(), 1700 + i * 110);
		});
	}

	function renderStats(bump) {
		const el = $('steps');
		el.textContent = String(game.steps);
		if (bump) {
			el.classList.remove('bump');
			void el.offsetWidth;
			el.classList.add('bump');
		}
	}

	/** 道具剩余次数：练习、新手、热身不限，其余关卡每关各一次（重来补满）。 */
	function propLeft(kind) {
		if (game.mode === 'practice' || game.level < FREE_LEVELS) return Infinity;
		return Math.max(0, LEVEL_LIMIT[kind] - game.propsUsed[kind]);
	}

	/** 走过步，或者用过提示/撤回（重来能补满），就能重来。 */
	function canRestart() {
		return game.steps > 0 || game.propsUsed.hint + game.propsUsed.undo > 0;
	}

	function renderProps() {
		const hl = propLeft('hint'), ul = propLeft('undo');
		$('hint-left').textContent = hl === Infinity ? '' : `×${hl}`;
		$('undo-left').textContent = ul === Infinity ? '' : `×${ul}`;
		$('btn-hint').disabled = game.done || hl <= 0;
		$('btn-undo').disabled = game.done || ul <= 0 || !game.history.length;
		$('btn-restart').disabled = game.done || !canRestart();
		if (restartArmed && !canRestart()) disarmRestart();
		$('props').hidden = game.done;
	}

	function currentStreak() {
		const today = todayKey();
		return store.last === today || store.last === shiftKey(today, -1) ? store.streak : 0;
	}

	function renderBottom() {
		const today = todayKey();
		const s = currentStreak();
		const counted = !!dayLevels(today)[COUNTS_AS_DAY];
		let text = s > 0 ? `已连缝 ${s} 天` : (store.best > 0 ? `最长连缝 ${store.best} 天` : '');
		if (!counted) text = text ? `${text} · 今天还没缝` : '今天还没缝';
		$('streak').textContent = text;
		const next = nextLevel(today);
		const isDaily = game.mode === 'daily';
		$('btn-result').hidden = !game.done;
		const stale = isDaily && game.key !== today;
		$('btn-next').hidden = !(isDaily && game.done && (stale || next !== null));
		$('btn-next').textContent = stale ? '去缝今天的' : (next !== null ? `下一关：${LEVELS[next].label}` : '');
		$('btn-practice').hidden = !counted && isDaily;
		$('btn-practice').textContent = isDaily ? '练习' : '回到今天';
	}

	function setHint(text) {
		$('hint').textContent = text;
	}

	function renderGuide(prefix = '') {
		tileEls.forEach(el => el.querySelector('.tag')?.remove());
		if (!guide || game.done) return;
		const [a, b] = guide;
		const tag = document.createElement('span');
		tag.className = 'tag';
		tag.textContent = selected === a ? '再点这块' : '先点这块';
		tileEls[selected === a ? b : a].appendChild(tag);
		const text = selected === a ? '好，再点写着「再点这块」的布，两块就换位置了'
			: game.tutorial ? tutorialText() : '跟着提示点两下，看看两块布怎么换位置';
		setHint(prefix + text);
	}

	function cornersDone() {
		const n = game.puzzle.n;
		return [0, n - 1, n * (n - 1), n * n - 1].every(pos => game.perm[pos] === pos);
	}

	// ---------- 操作：点一块再点一块，或者按住拖到另一块上 ----------
	function tileAt(x, y) {
		const el = document.elementFromPoint(x, y);
		const tileEl = el && el.closest ? el.closest('.tile') : null;
		return tileEl && board.contains(tileEl) ? Number(tileEl.dataset.t) : null;
	}

	function select(t) {
		if (selected !== null) tileEls[selected].classList.remove('sel');
		selected = t;
		if (t !== null) tileEls[t].classList.add('sel');
	}

	function setDropTarget(t) {
		if (drag && drag.over !== null) tileEls[drag.over].classList.remove('drop');
		if (drag) drag.over = t;
		if (t !== null) tileEls[t].classList.add('drop');
	}

	board.addEventListener('pointerdown', e => {
		if (!e.isPrimary || !game || game.done) return;
		e.preventDefault();
		ensureAudio();
		const t = tileAt(e.clientX, e.clientY);
		drag = t === null ? null : { id: e.pointerId, tile: t, over: null };
	});

	window.addEventListener('pointermove', e => {
		if (!drag || e.pointerId !== drag.id) return;
		const t = tileAt(e.clientX, e.clientY);
		const over = t !== null && t !== drag.tile ? t : null;
		if (over !== drag.over) {
			setDropTarget(over);
			if (over !== null && selected !== drag.tile) select(drag.tile);
		}
	});

	window.addEventListener('pointerup', e => {
		if (!drag || e.pointerId !== drag.id) return;
		const from = drag.tile;
		setDropTarget(null);
		drag = null;
		if (!game || game.done) return;
		const upTile = tileAt(e.clientX, e.clientY);
		if (upTile === null) {
			if (selected === from) select(null);
			return;
		}
		if (upTile !== from) {
			select(null);
			swapTiles(from, upTile);
			return;
		}
		tapTile(upTile);
	});

	window.addEventListener('pointercancel', () => {
		setDropTarget(null);
		drag = null;
	});

	board.addEventListener('keydown', e => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const el = e.target.closest('.tile');
		if (!el || !game || game.done) return;
		e.preventDefault();
		ensureAudio();
		tapTile(Number(el.dataset.t));
	});

	function tapTile(t) {
		if (selected === null) {
			// 引导中先点了别的布：玩家想自己来，就不再带着点
			if (guide && t !== guide[0]) guide = null;
			select(t);
			sound.tap();
			if (guide) renderGuide();
			else {
				renderGuide();
				setHint('再点一块布，和它交换位置');
			}
		} else if (selected === t) {
			select(null);
			if (guide) renderGuide();
			else setHint('点两块布交换位置，让所有接缝的花纹都对上');
		} else {
			const a = selected;
			select(null);
			swapTiles(a, t);
		}
	}

	function swapTiles(tA, tB) {
		const i = game.perm.indexOf(tA);
		const j = game.perm.indexOf(tB);
		const before = game.seamSet || new Set();
		const moves = game.moves.slice();
		moves[tA]++;
		moves[tB]++;
		const wasGuided = !!guide;
		const hinted = game.hinted.includes(tA) || game.hinted.includes(tB) ? [] : game.hinted;
		game = {
			...game,
			history: [...game.history, { perm: game.perm, tiles: [tA, tB] }],
			perm: Q.applySwap(game.perm, i, j),
			steps: game.steps + 1,
			moves,
			hinted,
		};
		guide = null;
		renderGuide();
		renderHinted();
		[tA, tB].forEach(t => {
			const el = tileEls[t];
			el.classList.add('moving');
			clearTimeout(el._movingTimer);
			el._movingTimer = setTimeout(() => el.classList.remove('moving'), 280);
		});
		placeTiles();
		sound.swap();
		buzz(8);
		const fresh = renderSeams(before, true);
		if (fresh > 0) sound.sew(game.seamSet.size);
		renderStats(true);
		renderProps();
		// 缝好的盘面不写进度：finish 会一次写好完成记录，别的标签页不会拿到已解盘面再庆祝一遍
		if (Q.isSolved(game.perm)) {
			finish();
			return;
		}
		saveProgress();
		if (game.tutorial) startGuide(fresh > 0 ? `看，深色针脚就是缝上了（${fresh} 道）！` : '');
		else if (wasGuided) setHint(fresh > 0 ? `看，对上的接缝自动缝上了 ${fresh} 道线` : '换好了，接着拼吧');
		else if (game.steps - game.puzzle.min > game.spec.stars[0]) setHint('多试几步也没关系，慢慢来');
		else setHint(cornersDone() ? TIPS[game.steps % TIPS.length] : TIP_CORNER);
	}

	function saveProgress() {
		if (game.mode !== 'daily' || game.done) return;
		const last = game.history[game.history.length - 1] || null;
		saveStore({
			progress: {
				date: game.key, level: game.level, perm: game.perm, steps: game.steps, moves: game.moves,
				prev: last, hinted: game.hinted, levelProps: game.levelProps, propsUsed: game.propsUsed, restarts: game.restarts,
			},
		});
	}

	// ---------- 道具 ----------
	/** 本关用过道具就没有金针（重来也不恢复）；当天总数只用来写进分享。 */
	function spendProp(kind) {
		game = { ...game, levelProps: game.levelProps + 1, propsUsed: { ...game.propsUsed, [kind]: game.propsUsed[kind] + 1 } };
		if (game.mode !== 'daily' || game.level < FREE_LEVELS) return;
		const used = usedProps(game.key);
		saveStore({ dayProps: { ...used, [kind]: used[kind] + 1 } });
	}

	$('btn-hint').addEventListener('click', () => {
		if (!game || game.done || propLeft('hint') <= 0) return;
		const pair = Q.hintSwap(game.puzzle.tiles, game.perm, game.puzzle.n);
		if (!pair) return;
		select(null);
		guide = null;
		renderGuide();
		game = { ...game, hinted: pair.map(pos => game.perm[pos]) };
		spendProp('hint');
		renderHinted();
		renderProps();
		saveProgress();
		setHint('把标着 ① ② 的两块布换一下');
	});

	// 重来：当前关回到开局，步数清零，提示和撤回补满（金针照样没有）。点两下确认，防止误触
	let restartArmed = null;
	function disarmRestart() {
		clearTimeout(restartArmed);
		restartArmed = null;
		$('btn-restart').textContent = '重来';
		$('btn-restart').classList.remove('armed');
	}
	$('btn-restart').addEventListener('click', () => {
		if (!game || game.done || !canRestart()) return;
		if (!restartArmed) {
			$('btn-restart').textContent = '确认重来';
			$('btn-restart').classList.add('armed');
			restartArmed = setTimeout(disarmRestart, 3000);
			return;
		}
		disarmRestart();
		restartLevel();
	});

	function restartLevel() {
		const size = game.puzzle.n * game.puzzle.n;
		const before = game.seamSet;
		game = {
			...game,
			perm: game.puzzle.start, steps: 0, moves: new Array(size).fill(0), history: [], hinted: [],
			propsUsed: NO_PROPS_USED, restarts: game.restarts + 1,
		};
		select(null);
		guide = null;
		renderGuide();
		renderHinted();
		placeTiles();
		renderSeams(before, false);
		renderStats(true);
		renderProps();
		saveProgress();
		sound.swap();
		buzz([8, 40, 8]);
		if (game.tutorial) startGuide('重新开始了。');
		else if (game.level < FREE_LEVELS || game.mode === 'practice') setHint('这一关重新开始了，步数从 0 算');
		else setHint(game.levelProps ? '提示和撤回已补满（本关用过道具，没有金针了）' : '重新开始了，提示和撤回已补满');
	}

	$('btn-undo').addEventListener('click', () => {
		if (!game || game.done || !game.history.length || propLeft('undo') <= 0) return;
		const before = game.seamSet;
		const last = game.history[game.history.length - 1];
		const moves = game.moves.slice();
		last.tiles.forEach(t => { moves[t] = Math.max(0, moves[t] - 1); });
		// 撤回不退步数：那一步已经走过了，撤回只是省掉再换回来的一步
		game = { ...game, perm: last.perm, history: game.history.slice(0, -1), moves, hinted: [] };
		spendProp('undo');
		select(null);
		renderHinted();
		placeTiles();
		renderSeams(before, false);
		renderStats(true);
		renderProps();
		saveProgress();
		sound.swap();
		setHint('退回了上一步（走过的步数照算）');
	});

	// ---------- 完成 ----------
	function finish() {
		const record = {
			steps: game.steps, min: game.puzzle.min,
			stars: Q.starsFor(game.steps, game.puzzle.min, game.spec.stars),
			gold: game.steps === game.puzzle.min && game.levelProps === 0,
			restarts: game.restarts,
		};
		game = { ...game, done: true, record, hinted: [], winShown: false };
		select(null);
		renderGuide();
		renderHinted();
		renderProps();
		board.classList.add('done');
		sound.win();
		buzz([10, 60, 20]);

		if (game.mode === 'daily' && !dayLevels(game.key)[game.level]) {
			const key = game.key;
			const levels = { ...dayLevels(key), [game.level]: record };
			const patch = { days: { ...store.days, [key]: { levels } }, progress: null };
			const firstCount = game.level >= COUNTS_AS_DAY && !Object.keys(dayLevels(key)).some(i => Number(i) >= COUNTS_AS_DAY);
			if (firstCount) {
				const streak = store.last === shiftKey(key, -1) ? store.streak + 1 : (store.last === key ? store.streak : 1);
				Object.assign(patch, { streak, last: (store.last || '') > key ? store.last : key });
			}
			saveStore(patch);
		}
		renderLevels();
		renderBottom();
		setHint(game.mode === 'daily' ? `第 ${game.level + 1} 关缝好了！` : '练习这床缝好了');
		celebrate(record);
		later(showWinWhenFree, CELEBRATE_MS);
	}

	function celebrate(record) {
		$('banner-name').textContent = game.mode === 'daily' ? `第 ${game.level + 1} 关 · ${game.spec.label}` : game.spec.label;
		$('banner-stars').innerHTML = '';
		$('banner').classList.add('show');
		const marks = record.gold ? ['金针'] : Array(record.stars).fill('★');
		marks.forEach((m, i) => {
			later(() => {
				const s = document.createElement('span');
				s.textContent = m;
				$('banner-stars').appendChild(s);
				sound.star(i);
				buzz(12);
			}, 700 + i * 380);
		});
		later(() => $('banner').classList.remove('show'), CELEBRATE_MS - 200);
	}

	/** 庆祝期间玩家打开了被柜或玩法：等那个弹窗关了再出结算，不叠在一起。 */
	function showWinWhenFree() {
		if (game.winShown) return;
		if (anyDialogOpen()) later(showWinWhenFree, 500);
		else showWin();
	}

	// ---------- 结算与分享 ----------
	function starText(stars) {
		return '★'.repeat(stars) + '☆'.repeat(3 - stars);
	}

	/** 🏆 要地狱关三星才给；各关都缝完但地狱没三星，只算全通。 */
	function dayTitle(key) {
		const done = dayLevels(key);
		if (Object.keys(done).length < LEVELS.length) return '';
		return done[LEVELS.length - 1].stars === 3 ? `🏆 ${LEVEL_WORD}全通 · 地狱三星` : `🧵 ${LEVEL_WORD}全通`;
	}

	/** 分享今天缝到第几关、每关几星几步。不带任何布块位置，不剧透。 */
	function shareText(key) {
		const num = dayNumber(key);
		const done = dayLevels(key);
		const reached = LEVELS.reduce((k, L, i) => (done[i] ? i + 1 : k), 0);
		const lines = [`百衲被 #${num} ${nameForDay(num)}`, dayTitle(key) || `🧵 缝到第 ${reached} 关`];
		LEVELS.forEach((L, i) => {
			const r = done[i];
			const mark = r ? (r.gold ? `✨金针 ${r.steps}步` : `${starText(r.stars)} ${r.steps}步`) : '—';
			lines.push(`${NUM_MARK[i]} ${i === LEVELS.length - 1 ? '🔥' : ''}${L.label} ${mark}`);
		});
		const used = usedProps(key);
		if (used.hint + used.undo) lines.push(`用了道具 ${used.hint + used.undo} 次`);
		const restarts = Object.values(done).reduce((k, r) => k + (r.restarts || 0), 0);
		if (restarts) lines.push(`重来 ${restarts} 次`);
		lines.push('你能缝到第几关？', location.origin + location.pathname);
		return lines.join('\n');
	}

	function showWin() {
		const g = game;
		if (!g || !g.record) return;
		const r = g.record;
		const over = r.steps - r.min;
		const isDaily = g.mode === 'daily';
		const stale = isDaily && g.key !== todayKey();
		const next = isDaily ? nextLevel(g.key) : null;
		$('win-kicker').textContent = isDaily ? `第 ${g.level + 1} 关 · ${g.spec.label} 缝好了` : `练习 · ${g.spec.label} 缝好了`;
		$('win-name').textContent = isDaily && next === null ? dayTitle(g.key) : g.name;
		$('win-stars').textContent = starText(r.stars);
		$('win-gold').textContent = r.gold ? '✨ 金针：一步不多，一针不差' : '';
		$('win-line').textContent = over <= 0
			? `${r.steps} 步，正好是最少步数${g.levelProps ? '（用了道具，没有金针）' : ''}`
			: `${r.steps} 步，最少 ${r.min} 步就能缝好`;
		const nextBtn = $('btn-win-next');
		nextBtn.hidden = isDaily && next === null && !stale;
		nextBtn.textContent = !isDaily ? '再练一床'
			: stale ? '去缝今天的'
				: `下一关：${LEVELS[next]?.label || ''}${next === LEVELS.length - 1 ? '（最难）' : ''}`;
		$('share-preview').hidden = !isDaily;
		$('btn-share').hidden = !isDaily;
		if (isDaily) $('share-preview').textContent = shareText(g.key);
		$('share-toast').textContent = '';
		const trophyTip = isDaily && next === null && !dayTitle(g.key).startsWith('🏆') ? '地狱关拿到三星才有 🏆。' : '';
		$('win-next').textContent = isDaily && next === null ? `${trophyTip}明天的${LEVEL_WORD} ${untilMidnight()} 后上新` : '';
		$('btn-win-practice').hidden = !isDaily || !dayLevels(g.key)[COUNTS_AS_DAY];
		game = { ...game, winShown: true };
		$('dlg-win').showModal();
		(nextBtn.hidden ? $('btn-share') : nextBtn).focus();
	}

	function untilMidnight() {
		const now = new Date();
		const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
		const mins = Math.max(1, Math.round((next - now) / 60000));
		return mins >= 60 ? `${Math.floor(mins / 60)} 小时 ${mins % 60} 分` : `${mins} 分钟`;
	}

	async function copyText(text) {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		$('dlg-win').appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		if (!ok) throw new Error('copy failed');
	}

	$('btn-share').addEventListener('click', async () => {
		const text = $('share-preview').textContent;
		const toast = $('share-toast');
		if (navigator.share) {
			try {
				await navigator.share({ text });
				return;
			} catch (err) {
				if (err && err.name === 'AbortError') return;
			}
		}
		try {
			await copyText(text);
			toast.textContent = '已复制，去聊天里粘贴吧';
		} catch {
			toast.textContent = '复制不了，请长按上面的文字手动复制';
		}
	});

	// ---------- 被柜 ----------
	function renderCabinet() {
		// 缝完「入门」关的日子才算「缝过」；只画最近 30 天，太多会卡
		const keys = Object.keys(store.days).filter(k => dayLevels(k)[COUNTS_AS_DAY]).sort().reverse();
		const shown = keys.slice(0, CABINET_MAX);
		$('cabinet-summary').textContent = keys.length
			? `已缝 ${keys.length} 天 · 连缝 ${currentStreak()} 天 · 最长 ${store.best} 天`
			: '';
		$('cabinet').innerHTML = keys.length
			? shown.map(k => {
				const done = dayLevels(k);
				const top = Math.max(...Object.keys(done).map(Number));
				const pz = levelPuzzle(k, top);
				const all = Object.keys(done).length === LEVELS.length;
				const title = all ? (dayTitle(k).startsWith('🏆') ? '🏆 地狱三星' : `${LEVEL_WORD}全通`) : `第 ${top + 1} 关`;
				return `<div class="cab-item">${tilesSvg(pz.tiles, pz.n)}<strong>${escapeHtml(nameForDay(dayNumber(k)))}</strong><span>#${dayNumber(k)} · ${title}</span></div>`;
			}).join('') + (keys.length > CABINET_MAX ? `<p class="cab-empty">更早的 ${keys.length - CABINET_MAX} 床收在柜子深处</p>` : '')
			: '<p class="cab-empty">还没有缝好的被子，先缝今天这床吧</p>';
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
	}

	// ---------- 玩法示意图、练习选项 ----------
	function renderStatic() {
		$('demo-match').innerHTML = tilesSvg([[2, 1, 3, 4], [4, 5, 2, 1]], 2, [[100, 16, 100, 84]]);
		$('demo-border').innerHTML = tilesSvg([[0, 3, 1, 0], [0, 0, 2, 3]], 2, [[100, 16, 100, 84]]);
		$('practice-choice').innerHTML = LEVELS.map((L, i) => (i < FREE_LEVELS ? '' :
			`<button class="choice-btn" data-practice="${i}">${L.label}<small>${L.n}×${L.n} · ${L.colors} 种花</small></button>`)).join('');
	}

	// ---------- 按钮与对话框 ----------
	function closeDialog(id) {
		const d = $(id);
		if (d.open) d.close();
	}
	function goNext() {
		closeDialog('dlg-win');
		if (game.mode === 'practice') {
			startPractice(game.level);
			return;
		}
		// 跨过零点后缝完的是昨天那关：回到今天，不接着玩昨天的
		if (game.key !== todayKey()) {
			startDaily();
			return;
		}
		const next = nextLevel(game.key);
		if (next !== null) playLevel(game.key, next);
	}
	document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog').close()));
	$('btn-help').addEventListener('click', openHelp);
	/** 打开玩法：焦点会落到底部的「开始缝」把内容滚到底，打开后滚回顶部，先看到标题和示意图。 */
	function openHelp() {
		const dlg = $('dlg-help');
		dlg.showModal();
		requestAnimationFrame(() => { dlg.scrollTop = 0; });
	}
	$('dlg-help').addEventListener('close', () => {
		if (!store.seenHelp) saveStore({ seenHelp: true });
	});
	$('btn-cabinet').addEventListener('click', () => { renderCabinet(); $('dlg-cabinet').showModal(); });
	$('btn-result').addEventListener('click', showWin);
	$('btn-next').addEventListener('click', goNext);
	$('btn-win-next').addEventListener('click', goNext);
	$('btn-practice').addEventListener('click', () => (game.mode === 'practice' ? startDaily() : $('dlg-practice').showModal()));
	$('btn-win-practice').addEventListener('click', () => { closeDialog('dlg-win'); $('dlg-practice').showModal(); });
	$('practice-choice').addEventListener('click', e => {
		const btn = e.target.closest('[data-practice]');
		if (!btn) return;
		closeDialog('dlg-practice');
		startPractice(Number(btn.dataset.practice));
	});
	$('levels').addEventListener('click', e => {
		const btn = e.target.closest('[data-level]');
		if (!btn || btn.disabled) return;
		const key = game.mode === 'daily' ? game.key : todayKey();
		const level = Number(btn.dataset.level);
		if (game.mode === 'daily' && game.level === level) return;
		playLevel(key, level);
	});

	function renderSoundBtn() {
		$('btn-sound').setAttribute('aria-pressed', String(store.sound));
	}
	$('btn-sound').addEventListener('click', () => {
		saveStore({ sound: !store.sound });
		renderSoundBtn();
		if (store.sound) sound.tap();
	});

	// 另一个标签页存了档：合并进来；当前这关在那边缝好了，这边也切到已完成
	window.addEventListener('storage', e => {
		if (e.key !== STORE_KEY) return;
		store = mergeStores(readDisk(), store);
		if (!game) return;
		const p = store.progress;
		const sameLevel = p && game.mode === 'daily' && !game.done && p.date === game.key && p.level === game.level;
		const aheadElsewhere = sameLevel && (p.steps > game.steps || (isInt(p.levelProps) && p.levelProps > game.levelProps));
		if (game.mode === 'daily' && !game.done && dayLevels(game.key)[game.level]) playLevel(game.key, game.level);
		else if (aheadElsewhere) {
			playLevel(game.key, game.level);
			setHint('已接上另一个页面里的进度');
		} else {
			renderLevels();
			renderProps();
			renderBottom();
		}
	});

	// 页面开着跨过零点：空闲时换成新的一天，正在缝或开着弹窗时只提醒
	function checkNewDay() {
		if (!game || game.mode === 'practice' || game.key === todayKey()) return;
		if (anyDialogOpen() || (!game.done && game.steps > 0) || (game.done && game.winShown === false)) {
			setHint('新的一天已经上新，缝完这床就能去缝');
			renderBottom();
			return;
		}
		startDaily();
	}
	document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNewDay(); });
	// 屏幕转向、窗口缩放后棋盘变大变小，线宽下限跟着重算
	if (window.ResizeObserver) new ResizeObserver(updateLineScale).observe(board);
	else window.addEventListener('resize', updateLineScale);
	setInterval(checkNewDay, 60000);

	// 测试用：暴露只读状态，方便自动化等待
	Object.defineProperty(window, '__quilt', {
		get: () => (game ? {
			mode: game.mode, key: game.key, level: game.level, steps: game.steps, min: game.puzzle.min, n: game.puzzle.n,
			perm: game.perm.slice(), done: game.done, hinted: game.hinted.slice(), props: { ...usedProps(game.key || todayKey()) },
		} : null),
	});

	renderSoundBtn();
	renderStatic();
	try {
		startDaily();
	} catch (err) {
		// 存档异常导致起不来：清掉进度重来一次，不白屏
		console.error('[quilt] 启动失败，已重置进度', err);
		saveStore({ progress: null });
		startDaily();
	}
	if (!store.seenHelp) openHelp();
})();
