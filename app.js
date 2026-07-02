/* ============================================================================
   رادار / RADAR — بروتوتايب هاكاثون (محاكاة UI/UX فقط)
   محرك تقييم مخاطر لحظي قائم على قواعد مرجّحة (weighted rules) — ليس ML مدرّبًا.
   كل البيانات اصطناعية، وكل الحالة في الذاكرة (بدون أي تخزين).
   ============================================================================ */
'use strict';

/* ============================================================================
   1) CONFIG — الأوزان، العتبات، المدن، التجّار، النصوص الثابتة للسيناريوهات
   ============================================================================ */
const CONFIG = {
  weights: { geo: 0.35, device: 0.25, financial: 0.25, time: 0.15 },
  thresholds: { fraud: 70, review: 40 },  // composite ≥70 احتيال · 40–69 مراجعة · <40 آمنة
  feedIntervalMs: 1500,
  maxFeedRows: 12,
  seed: 20260702, // بذرة PRNG — تجعل التدفّق نفسه قابلًا لإعادة الإنتاج في كل عرض

  cities: [
    { ar: 'الرياض', en: 'Riyadh' },
    { ar: 'جدة', en: 'Jeddah' },
    { ar: 'الدمام', en: 'Dammam' },
    { ar: 'مكة المكرمة', en: 'Makkah' },
    { ar: 'الخبر', en: 'Khobar' },
    { ar: 'المدينة المنورة', en: 'Madinah' },
  ],
  merchants: [
    { ar: 'بندة', en: 'Panda' },
    { ar: 'العثيم', en: 'Othaim Markets' },
    { ar: 'جرير', en: 'Jarir Bookstore' },
    { ar: 'نون', en: 'Noon' },
    { ar: 'هنقرستيشن', en: 'HungerStation' },
    { ar: 'أمازون السعودية', en: 'Amazon.sa' },
    { ar: 'STC Pay', en: 'STC Pay' },
    { ar: 'الدانوب', en: 'Danube' },
    { ar: 'كريم', en: 'Careem' },
    { ar: 'محطة أرامكو', en: 'Aramco Station' },
    { ar: 'شاورمر', en: 'Shawarmer' },
    { ar: 'طلبات', en: 'Talabat' },
  ],

  // توزيع أنماط التوليد: أغلب المعاملات آمنة لتبدو واقعية على البروجكتر
  profiles: [
    { p: 0.78, ranges: { geo: [2, 25], device: [2, 20], financial: [4, 30], time: [4, 34] }, amount: [18, 2400] },
    { p: 0.14, ranges: { geo: [30, 62], device: [22, 55], financial: [35, 66], time: [28, 68] }, amount: [900, 9800] },
    { p: 0.08, ranges: { geo: [70, 97], device: [55, 92], financial: [62, 95], time: [50, 90] }, amount: [8000, 58000] },
  ],
};

// الأبعاد الأربعة — الاسم التقني يبقى إنجليزيًا في الوضعين
const DIMS = [
  { key: 'geo',       en: 'Geo-Velocity',        ar: 'السفر المستحيل',   w: CONFIG.weights.geo },
  { key: 'device',    en: 'Device Intelligence', ar: 'ذكاء الجهاز',      w: CONFIG.weights.device },
  { key: 'financial', en: 'Financial Flow',      ar: 'التدفّق المالي',   w: CONFIG.weights.financial },
  { key: 'time',      en: 'Time Context',        ar: 'السياق الزمني',    w: CONFIG.weights.time },
];

// أسطر التفسير لكل reason code (الكود نفسه يبقى إنجليزيًا mono دائمًا)
const REASONS = {
  GEO_VELOCITY_IMPOSSIBLE: { sev: 'danger', ar: 'قفزة الرياض → لندن خلال 41 دقيقة — سفر مستحيل فيزيائيًا', en: 'Riyadh → London jump in 41 min — physically impossible travel' },
  GEO_VELOCITY_SUSPICIOUS: { sev: 'warn',   ar: 'موقع جديد — يتّسق مع نمط سفر معروف للعميل',              en: 'New location — consistent with a known travel pattern' },
  GEO_OK:                  { sev: 'ok',     ar: 'الموقع ضمن النمط الجغرافي المعتاد للعميل',                en: 'Location within the customer’s usual geo pattern' },
  ROOT_DETECTED:           { sev: 'danger', ar: 'جهاز غير معروف + اكتشاف Root/Jailbreak',                  en: 'Unknown device + Root/Jailbreak detected' },
  IP_ANOMALY:              { sev: 'warn',   ar: 'شذوذ IP — شبكة غير معتادة لهذا الحساب',                   en: 'IP anomaly — unusual network for this account' },
  TRUSTED_DEVICE_OK:       { sev: 'ok',     ar: 'جهاز موثوق مسجّل منذ 14 شهرًا',                            en: 'Trusted device enrolled 14 months ago' },
  NEW_BENEFICIARY:         { sev: 'danger', ar: 'مستفيد جديد + مبلغ يفوق متوسط العميل ×9',                 en: 'New beneficiary + amount 9× above customer average' },
  AMOUNT_ANOMALY:          { sev: 'warn',   ar: 'مبلغ أعلى من متوسط إنفاق العميل',                         en: 'Amount above the customer’s spending average' },
  FLOW_NORMAL:             { sev: 'ok',     ar: 'تدفّق مالي ضمن النمط الطبيعي',                            en: 'Financial flow within normal pattern' },
  UNUSUAL_HOUR:            { sev: 'warn',   ar: '03:12 فجرًا — خارج ساعات نشاط العميل المعتادة',           en: '03:12 AM — outside the customer’s usual active hours' },
  TIME_OK:                 { sev: 'ok',     ar: 'التوقيت ضمن ساعات النشاط المعتادة',                       en: 'Timing within usual active hours' },
};

const VERDICTS = {
  safe:   { ar: 'آمنة',   en: 'SAFE',   pill: 'pill-safe',   color: '#00E5A0' },
  review: { ar: 'مراجعة', en: 'REVIEW', pill: 'pill-review', color: '#FFB020' },
  fraud:  { ar: 'احتيال', en: 'FRAUD',  pill: 'pill-fraud',  color: '#FF4D5E' },
};

/* ---- معاملتا السيناريوهين — حتميتان بالكامل (قيم ثابتة، لا عشوائية) ---- */
const FRAUD_TXN = {
  id: 'F-88231', mask: '****7311', amount: 48750,
  merchant: { ar: 'تحويل دولي — مستفيد جديد', en: 'International transfer — new beneficiary' },
  city: { ar: 'لندن 🇬🇧', en: 'London 🇬🇧' },
  dims: { geo: 96, device: 78, financial: 82, time: 65 },
  reasons: ['GEO_VELOCITY_IMPOSSIBLE', 'ROOT_DETECTED', 'NEW_BENEFICIARY', 'UNUSUAL_HOUR'],
  latency: 73, timeStr: '03:12:44',
};
const FP_TXN = {
  id: 'T-90417', mask: '****2384', amount: 2340,
  merchant: { ar: 'مطار دبي الدولي — DXB Duty Free', en: 'Dubai Intl Airport — DXB Duty Free' },
  city: { ar: 'دبي 🇦🇪', en: 'Dubai 🇦🇪' },
  dims: { geo: 66, device: 18, financial: 45, time: 38 },
  reasons: ['GEO_VELOCITY_SUSPICIOUS', 'TRUSTED_DEVICE_OK', 'AMOUNT_ANOMALY', 'TIME_OK'],
  latency: 73, timeStr: '11:24:09',
};

/* ============================================================================
   2) I18N — كل نصوص الواجهة (ع / EN)
   ============================================================================ */
const T = {
  brand:            { ar: 'رادار', en: 'Radar' },
  tagline:          { ar: 'محرك تقييم مخاطر لحظي · قواعد مرجّحة', en: 'Real-time risk engine · weighted rules' },
  simTag:           { ar: 'مستهدف · محاكاة', en: 'target · simulated' },
  kpiFalseAlarms:   { ar: 'إنذارات كاذبة تم تفاديها', en: 'False alarms avoided' },
  kpiCostSaved:     { ar: 'تكلفة موفّرة (ريال)', en: 'Cost saved (SAR)' },
  kpiTps:           { ar: 'معاملات / ثانية', en: 'Transactions / sec' },
  kpiLatency:       { ar: 'متوسط زمن الاستجابة', en: 'Avg response time' },
  feedTitle:        { ar: 'التدفّق المباشر للمعاملات', en: 'Live Transaction Stream' },
  feedLive:         { ar: 'LIVE', en: 'LIVE' },
  feedPaused:       { ar: 'PAUSED', en: 'PAUSED' },
  colTxn:           { ar: 'المعاملة', en: 'Transaction' },
  colAmount:        { ar: 'المبلغ', en: 'Amount' },
  colScore:         { ar: 'الخطر', en: 'Risk' },
  feedHint:         { ar: 'انقر أي معاملة لفتح تحليلها في محرك رادار ←', en: '→ Click any transaction to open its analysis' },
  engineTitle:      { ar: 'محرك رادار — التحليل عبر 4 أبعاد', en: 'Radar Engine — 4-Dimension Analysis' },
  engineSub:        { ar: 'تقييم لحظي قائم على قواعد مرجّحة (weighted rules) — وليس نموذج تعلّم آلي مدرّب.', en: 'Real-time scoring via weighted rules — not a trained ML model.' },
  precisionTag:     { ar: 'دقة مستهدفة · محاكاة', en: 'target precision · simulated' },
  enginePlaceholder:{ ar: 'اختر معاملة من التدفّق لعرض تحليلها', en: 'Select a transaction from the stream to view its analysis' },
  compositeLabel:   { ar: 'تكوين الدرجة المركّبة', en: 'Composite score breakdown' },
  thFraud:          { ar: 'احتيال', en: 'fraud' },
  thReview:         { ar: 'مراجعة', en: 'review' },
  thSafe:           { ar: 'آمنة', en: 'safe' },
  latencyLabel:     { ar: 'زمن القرار', en: 'Decision time' },
  runVerify:        { ar: 'تشغيل التحقّق الصامت المتدرّج', en: 'Run tiered silent verification' },
  mapTitle:         { ar: 'الخريطة العالمية للتهديدات — عرض المهاجم', en: 'Global Threat Map — Attacker View' },
  mapSub:           { ar: 'سيناريو: مهاجم في لندن يحاول الدخول على حساب عميل في الرياض', en: 'Scenario: an attacker in London targets a customer account in Riyadh' },
  mapTimerLabel:    { ar: 'زمن الكشف والتجميد', en: 'Detect & freeze time' },
  mapFrozen:        { ar: 'تم تجميد الجلسة خلال', en: 'Session frozen within' },
  londonLabel:      { ar: 'لندن · المهاجم', en: 'London · Attacker' },
  riyadhLabel:      { ar: 'الرياض · العميل', en: 'Riyadh · Customer' },
  riyadhVerify:     { ar: '📲 طلب تحقّق', en: '📲 Verification request' },
  cmpTitle:         { ar: 'بنك تقليدي ضد رادار — سيناريو الإنذار الكاذب', en: 'Legacy Bank vs Radar — False-Positive Scenario' },
  cmpSub:           { ar: 'عميل شرعي يمرّر بطاقته في مطار دبي الدولي (DXB)', en: 'A legitimate customer swipes their card at Dubai Intl Airport (DXB)' },
  cmpRetained:      { ar: 'العملاء المحتفظ بهم', en: 'Customers retained' },
  cmpRevenue:       { ar: 'الإيراد المحمي (ريال)', en: 'Revenue protected (SAR)' },
  cmpRun:           { ar: '▶ تشغيل سيناريو الإنذار الكاذب', en: '▶ Run false-positive scenario' },
  cmpLegacy:        { ar: '🏦 بنك تقليدي', en: '🏦 Legacy Bank' },
  cmpRadar:         { ar: '📡 رادار', en: '📡 Radar' },
  cmpBlocked:       { ar: '⛔ بطاقة محظورة', en: '⛔ CARD BLOCKED' },
  cmpAgentCall:     { ar: 'تم إرسال مكالمة وكيل:', en: 'Agent call dispatched:' },
  cmpAngry:         { ar: '😠 عميل محبط · خطر إلغاء البطاقة', en: '😠 Frustrated customer · card-cancellation risk' },
  cmpKept:          { ar: '✓ تم الاحتفاظ بالعميل', en: '✓ CUSTOMER RETAINED' },
  cmpCost:          { ar: 'التكلفة:', en: 'Cost:' },
  cmpFriction:      { ar: 'الاحتكاك:', en: 'Friction:' },
  cmpZero:          { ar: 'صفر', en: 'zero' },
  sar:              { ar: 'ريال', en: 'SAR' },
  modalTitle:       { ar: 'التحقّق الصامت المتدرّج', en: 'Tiered Silent Verification' },
  tier1Name:        { ar: 'تحقّق صامت', en: 'Silent verify' },
  tier2Name:        { ar: 'نفاذ', en: 'Nafath' },
  tier3Name:        { ar: 'بوت صوتي', en: 'Voice bot' },
  tier1Scanning:    { ar: 'تحقّق حيوي مربوط بالجهاز…', en: 'Device-bound biometric check…' },
  tier1Done:        { ar: 'تم التحقّق خلال ~2 ثانية — بدون أي احتكاك', en: 'Verified in ~2s — zero friction' },
  btnIgnore:        { ar: 'تجاهل الإشعار → التصعيد لنفاذ', en: 'Ignore push → escalate to Nafath' },
  tier2Gov:         { ar: 'توثيق حكومي · للمعاملات عالية القيمة', en: 'Gov-grade auth · for high-value transactions' },
  tier2Prompt:      { ar: 'الرمز الظاهر في تطبيق البنك:', en: 'Code shown in the banking app:' },
  tier2Pick:        { ar: 'اختر الرمز المطابق في تطبيق نفاذ:', en: 'Pick the matching code in the Nafath app:' },
  tier2Wrong:       { ar: 'رمز غير مطابق — حاول مرة أخرى', en: 'Code mismatch — try again' },
  btnNoNafath:      { ar: 'لم تصلك المطابقة؟ → اتصال آلي تنبيهي', en: 'No Nafath prompt? → automated alert call' },
  tier3Calling:     { ar: 'مكالمة تنبيه آلية — رادار', en: 'Automated alert call — Radar' },
  tier3Script:      { ar: '«هذه مكالمة تنبيه آلية من رادار. لن نطلب منك أي رمز أو كلمة مرور أو معلومات — إطلاقًا. يرجى فتح تطبيق البنك لإكمال التأكيد داخل التطبيق فقط.»', en: '“This is an automated alert call from Radar. We will never ask for any code, password, or information. Please open your banking app to complete confirmation in-app only.”' },
  tier3SimNote:     { ar: 'قبل الاتصال، تم فحص ربط الرقم بالشريحة عبر خدمة «تحقّق» للتأكد من عدم حدوث تبديل شريحة (SIM Swap) حديث. المكالمة تنبيه فقط — لا يتم أي تحقّق عبر المكالمة.', en: 'Before dialing, the number-to-SIM binding was checked via “Tahaqaq” to rule out a recent SIM swap. The call only alerts — no verification ever happens over the call.' },
  tier3Open:        { ar: 'فتح التطبيق لإكمال التأكيد', en: 'Open app to complete confirmation' },
  dockFraud:        { ar: '▶ سيناريو الاحتيال (الرياض ← لندن)', en: '▶ Fraud scenario (London → Riyadh)' },
  dockFP:           { ar: '▶ سيناريو الإنذار الكاذب (دبي)', en: '▶ False-positive scenario (Dubai)' },
  dockPause:        { ar: '⏸ إيقاف التدفّق', en: '⏸ Pause stream' },
  dockResume:       { ar: '▶ استئناف التدفّق', en: '▶ Resume stream' },
  customer:         { ar: 'عميل', en: 'Customer' },
  // خطوات سيناريو المقارنة
  stSwipe:          { ar: '💳 تمرير بطاقة — مطار دبي (DXB) · 2,340 SAR', en: '💳 Card swipe — Dubai Airport (DXB) · 2,340 SAR' },
  stLegacyRule:     { ar: '⚠️ قاعدة صمّاء: «معاملة أجنبية» → حظر فوري', en: '⚠️ Blunt rule: “foreign transaction” → instant block' },
  stLegacyCall:     { ar: '📞 العميل ينتظر مركز الاتصال… ~11 دقيقة', en: '📞 Customer waits on the call center… ~11 min' },
  stRadarScore:     { ar: '📡 تقييم رادار: composite 45 → REVIEW · 73ms', en: '📡 Radar score: composite 45 → REVIEW · 73ms' },
  stRadarPush:      { ar: '📲 إشعار تحقّق صامت (FaceID) — نقرة ①', en: '📲 Silent verification push (FaceID) — tap ①' },
  stRadarTap:       { ar: '✓ تأكيد العملية — نقرة ②', en: '✓ Confirm transaction — tap ②' },
};

/* ============================================================================
   3) UTILS — PRNG مبذور، تنسيق أرقام، عدّادات count-up
   ============================================================================ */

// mulberry32: مولّد أرقام شبه عشوائية مبذور — نفس التسلسل في كل عرض
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(CONFIG.seed);
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const fmt = (n, dec = 0) => n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// عدّاد تصاعدي سلس (rAF) — يُلغي أي عدّاد سابق على نفس العنصر
function countUp(el, to, { from = 0, dur = 1000, dec = 0, suffix = '' } = {}) {
  if (el._raf) cancelAnimationFrame(el._raf);
  const t0 = performance.now();
  function frame(now) {
    const p = Math.min((now - t0) / dur, 1);
    const val = from + (to - from) * easeOut(p);
    el.textContent = fmt(val, dec) + suffix;
    if (p < 1) el._raf = requestAnimationFrame(frame);
  }
  el._raf = requestAnimationFrame(frame);
}

// وقت الرياض HH:MM:SS
function riyadhTime() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
}

const $ = (id) => document.getElementById(id);

/* ============================================================================
   الحالة — في الذاكرة فقط
   ============================================================================ */
const state = {
  lang: 'ar',
  feedPaused: false,
  feedTimer: null,
  transactions: [],       // الأحدث أولًا
  selectedId: null,
  txnCounter: 84120,
  scenarioToken: 0,       // يُبطل أي سيناريو سابق عند تشغيل جديد
  scenarioTimers: [],
  modalTimer: null,
  wasFeedRunning: true,
  kpi: { falseAlarms: 1284, costSaved: 19187, tps: 1243, retained: 0, revenue: 0 },
};

const t = (key) => (T[key] ? T[key][state.lang] : key);

/* ============================================================================
   4) مولّد البيانات — معاملات سعودية اصطناعية
   ============================================================================ */
function pickProfile() {
  const r = rng();
  let acc = 0;
  for (const prof of CONFIG.profiles) {
    acc += prof.p;
    if (r < acc) return prof;
  }
  return CONFIG.profiles[0];
}

function makeTxn() {
  const prof = pickProfile();
  const dims = {};
  for (const d of DIMS) {
    const [lo, hi] = prof.ranges[d.key];
    dims[d.key] = randInt(lo, hi);
  }
  state.txnCounter += randInt(1, 7);
  return finalizeTxn({
    id: 'T-' + state.txnCounter,
    mask: '****' + randInt(1000, 9999),
    amount: randInt(prof.amount[0], prof.amount[1]),
    merchant: pick(CONFIG.merchants),
    city: pick(CONFIG.cities),
    dims,
    latency: randInt(38, 78),
    timeStr: riyadhTime(),
  });
}

/* ============================================================================
   5) محرك التقييم — جمع موزون + reason codes + تصنيف
   ============================================================================ */
function deriveReason(dimKey, score) {
  const hi = score >= 70, mid = score >= 40;
  switch (dimKey) {
    case 'geo':       return hi ? 'GEO_VELOCITY_IMPOSSIBLE' : mid ? 'GEO_VELOCITY_SUSPICIOUS' : 'GEO_OK';
    case 'device':    return hi ? 'ROOT_DETECTED'           : mid ? 'IP_ANOMALY'              : 'TRUSTED_DEVICE_OK';
    case 'financial': return hi ? 'NEW_BENEFICIARY'         : mid ? 'AMOUNT_ANOMALY'          : 'FLOW_NORMAL';
    case 'time':      return hi ? 'UNUSUAL_HOUR'            : mid ? 'UNUSUAL_HOUR'            : 'TIME_OK';
  }
}

function classify(composite) {
  if (composite >= CONFIG.thresholds.fraud) return 'fraud';
  if (composite >= CONFIG.thresholds.review) return 'review';
  return 'safe';
}

// يُكمل المعاملة: الدرجة المركّبة، التصنيف، والأكواد (ما لم تكن مثبّتة مسبقًا للسيناريو)
function finalizeTxn(txn) {
  const composite = Math.round(DIMS.reduce((sum, d) => sum + d.w * txn.dims[d.key], 0));
  txn.composite = composite;
  txn.verdict = classify(composite);
  if (!txn.reasons) txn.reasons = DIMS.map((d) => deriveReason(d.key, txn.dims[d.key]));
  return txn;
}

/* ============================================================================
   6) RENDER — التدفّق، لوحة المحرك، KPIs، اللغة
   ============================================================================ */

/* ---------- التدفّق المباشر ---------- */
function feedRowHTML(txn) {
  const v = VERDICTS[txn.verdict];
  return `
    <div>
      <div class="text-sm font-semibold">${t('customer')} <span class="num">${txn.mask}</span> · ${txn.merchant[state.lang]}</div>
      <div class="text-[.66rem] text-slate-400">${txn.city[state.lang]} · <span class="num">${txn.timeStr}</span></div>
    </div>
    <div class="num text-sm font-bold self-center">${fmt(txn.amount)} <span class="text-[.6rem] text-slate-400">SAR</span></div>
    <div class="flex items-center gap-2 self-center">
      <span class="num font-bold text-sm" style="color:${v.color}">${txn.composite}</span>
      <span class="pill ${v.pill}">${v[state.lang]}</span>
    </div>`;
}

function renderFeedRow(txn, { animate = true } = {}) {
  const list = $('feedList');
  const row = document.createElement('div');
  row.className = 'feed-row glass-inner grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2';
  if (!animate) row.style.animation = 'none';
  row.dataset.txnId = txn.id;
  row.innerHTML = feedRowHTML(txn);
  row.addEventListener('click', () => selectTxn(txn.id));
  list.prepend(row);
  // قصّ القائمة القديمة
  while (list.children.length > CONFIG.maxFeedRows) list.lastElementChild.remove();
}

function pushTxn(txn, opts) {
  state.transactions.unshift(txn);
  if (state.transactions.length > 60) state.transactions.length = 60;
  renderFeedRow(txn, opts);
}

function rebuildFeed() { // عند تبديل اللغة
  $('feedList').innerHTML = '';
  const visible = state.transactions.slice(0, CONFIG.maxFeedRows).reverse();
  for (const txn of visible) renderFeedRow(txn, { animate: false });
  if (state.selectedId) highlightRow(state.selectedId);
}

function highlightRow(id) {
  document.querySelectorAll('.feed-row').forEach((r) => r.classList.toggle('selected', r.dataset.txnId === id));
}

function tickFeed() {
  if (state.feedPaused) return;
  pushTxn(makeTxn());
  bumpKpis();
}

function setFeedPaused(paused) {
  state.feedPaused = paused;
  $('pauseLabel').textContent = paused ? t('dockResume') : t('dockPause');
  $('feedStatus').textContent = paused ? t('feedPaused') : t('feedLive');
  const dot = $('feedLiveDot');
  dot.style.background = paused ? '#FFB020' : '#00E5A0';
  dot.style.boxShadow = paused ? '0 0 10px #FFB020' : '0 0 10px #00E5A0';
}

/* ---------- لوحة المحرك ---------- */
function selectTxn(id) {
  const txn = state.transactions.find((x) => x.id === id);
  if (!txn) return;
  state.selectedId = id;
  highlightRow(id);
  renderEngine(txn);
}

function dimColor(score) {
  return score >= 70 ? '#FF4D5E' : score >= 40 ? '#FFB020' : '#00E5A0';
}

function renderEngine(txn) {
  $('enginePlaceholder').classList.add('hidden');
  const content = $('engineContent');
  content.classList.remove('hidden');
  content.classList.add('flex');

  const v = VERDICTS[txn.verdict];
  $('engTxnTitle').textContent = `${t('customer')} ${txn.mask} · ${txn.merchant[state.lang]}`;
  $('engTxnMeta').innerHTML = `<span class="num">${txn.id}</span> · ${txn.city[state.lang]} · <span class="num">${fmt(txn.amount)} SAR</span> · <span class="num">${txn.timeStr}</span>`;

  // الدرجة المركّبة + الحكم
  const compEl = $('engComposite');
  compEl.style.color = v.color;
  compEl.style.textShadow = `0 0 20px ${v.color}66`;
  countUp(compEl, txn.composite, { dur: 900 });
  const verdictEl = $('engVerdict');
  verdictEl.className = `pill ${v.pill} inline-block mt-1`;
  verdictEl.textContent = v[state.lang];

  // الأبعاد الأربعة
  const dimsEl = $('engDims');
  dimsEl.innerHTML = DIMS.map((d) => {
    const score = txn.dims[d.key];
    const code = txn.reasons.find((c) => c === deriveReason(d.key, score)) || deriveReason(d.key, score);
    const line = REASONS[code] ? REASONS[code][state.lang] : '';
    const c = dimColor(score);
    return `
      <div class="glass-inner p-3">
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center gap-2">
            <span class="num text-xs font-bold text-slate-200">${d.en}</span>
            <span class="text-[.68rem] text-slate-400">${state.lang === 'ar' ? d.ar : ''}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="num text-[.64rem] text-slate-500">w ${d.w.toFixed(2)}</span>
            <span class="num font-bold text-lg" style="color:${c}; text-shadow:0 0 12px ${c}55">${score}</span>
          </div>
        </div>
        <div class="h-2 rounded-full overflow-hidden" style="background:rgba(255,255,255,.06)">
          <div class="dim-fill" data-w="${score}" style="background:${c}; box-shadow:0 0 12px ${c}99"></div>
        </div>
        <div class="text-[.7rem] text-slate-400 mt-1.5">${line}</div>
      </div>`;
  }).join('');
  // إطلاق أنيميشن الأشرطة بعد إدراجها
  requestAnimationFrame(() => {
    dimsEl.querySelectorAll('.dim-fill').forEach((bar) => { bar.style.width = bar.dataset.w + '%'; });
  });

  // معادلة التكوين
  const parts = DIMS.map((d) => `${d.w.toFixed(2)}×${txn.dims[d.key]}`).join(' + ');
  $('engFormula').textContent = `${parts} = ${txn.composite}`;

  // reason codes
  $('engReasons').innerHTML = txn.reasons.map((code) => {
    const sev = REASONS[code] ? REASONS[code].sev : 'warn';
    return `<span class="rcode rcode-${sev}">${code}</span>`;
  }).join('');

  // عدّاد الزمن — يقف دائمًا تحت 80ms
  countUp($('engLatency'), txn.latency, { dur: 850 });

  // زر التحقّق المتدرّج للمعاملات غير الآمنة
  const btn = $('engVerifyBtn');
  btn.classList.toggle('hidden', txn.verdict === 'safe');
  btn.onclick = () => openModal(txn);
}

/* ---------- KPIs ---------- */
function initKpis() {
  countUp($('kpiFalseAlarms'), state.kpi.falseAlarms, { dur: 1600 });
  countUp($('kpiCostSaved'), state.kpi.costSaved, { dur: 1800 });
  countUp($('kpiTps'), state.kpi.tps, { dur: 1400 });
  $('kpiLatency').textContent = '78';
}

function bumpKpis() {
  // كل «تكة» تدفّق: احتمالية تفادي إنذار كاذب (توفير 15 − 0.05 ريال لكل حالة)
  if (rng() < 0.35) {
    state.kpi.falseAlarms += 1;
    state.kpi.costSaved += 14.95;
    $('kpiFalseAlarms').textContent = fmt(state.kpi.falseAlarms);
    countUp($('kpiCostSaved'), state.kpi.costSaved, { from: state.kpi.costSaved - 14.95, dur: 600 });
  }
  state.kpi.tps = 1243 + randInt(-38, 38);
  $('kpiTps').textContent = fmt(state.kpi.tps);
  $('kpiLatency').textContent = String(randInt(74, 79));
}

/* ---------- اللغة ---------- */
function setLang(lang) {
  state.lang = lang;
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  $('langLabel').textContent = lang === 'ar' ? 'EN' : 'ع';

  // النصوص الثابتة
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (T[key]) el.textContent = T[key][lang];
  });

  // نصوص SVG في الخريطة
  $('londonLabel').textContent = t('londonLabel');
  $('riyadhLabel').textContent = t('riyadhLabel');
  $('riyadhVerify').textContent = t('riyadhVerify');

  // العناصر الديناميكية
  setFeedPaused(state.feedPaused);
  rebuildFeed();
  const sel = state.transactions.find((x) => x.id === state.selectedId);
  if (sel) renderEngine(sel);
}

/* ============================================================================
   7) السيناريوهات — حتمية بالكامل (قيم وتوقيتات ثابتة)
   ============================================================================ */

// جدولة خطوات سيناريو مع إمكانية الإبطال عند تشغيل سيناريو جديد
function clearScenarioTimers() {
  state.scenarioTimers.forEach(clearTimeout);
  state.scenarioTimers.length = 0;
  state.scenarioToken += 1;
}
function later(fn, ms) {
  const token = state.scenarioToken;
  state.scenarioTimers.push(setTimeout(() => { if (token === state.scenarioToken) fn(); }, ms));
}

/* ---------- سيناريو 1: الاحتيال (الرياض ← لندن) ---------- */
function resetMapState() {
  const arc = $('attackArc');
  const len = arc.getTotalLength();
  arc.style.strokeDasharray = len;
  arc.style.strokeDashoffset = len;
  arc.setAttribute('opacity', '0');
  $('arcComet').setAttribute('opacity', '0');
  $('arcDistance').setAttribute('opacity', '0');
  $('mapVerdict').classList.add('hidden');
  const dot = $('londonDot');
  dot.classList.remove('attacker-flash');
  dot.setAttribute('fill', '#FF4D5E');
  dot.setAttribute('opacity', '.85');
  dot.style.filter = '';
  $('londonLock').setAttribute('opacity', '0');
  const halo = $('riyadhHalo');
  halo.classList.remove('cust-verify');
  halo.setAttribute('opacity', '0');
  $('riyadhVerify').setAttribute('opacity', '0');
  $('mapTimer').innerHTML = '0<span class="text-lg">ms</span>';
}

function runFraudScenario() {
  clearScenarioTimers();
  closeModal(true);
  state.wasFeedRunning = !state.feedPaused;
  setFeedPaused(true);
  resetMapState();
  $('mapSection').scrollIntoView({ behavior: 'smooth', block: 'center' });

  const token = state.scenarioToken;
  const arc = $('attackArc');
  const comet = $('arcComet');
  const len = arc.getTotalLength();

  // t=600ms: رسم القوس + عدّاد المللي ثانية 0→73 متزامنان
  later(() => {
    arc.setAttribute('opacity', '1');
    comet.setAttribute('opacity', '1');
    const t0 = performance.now();
    const DUR = 1100; // مدة الأنيميشن البصري (العدّاد يعرض 73ms كزمن قرار محاكى)
    (function frame(now) {
      if (token !== state.scenarioToken) return;
      const p = Math.min((now - t0) / DUR, 1);
      const e = easeOut(p);
      arc.style.strokeDashoffset = len * (1 - e);
      const pt = arc.getPointAtLength(len * e);
      comet.setAttribute('cx', pt.x);
      comet.setAttribute('cy', pt.y);
      $('mapTimer').innerHTML = Math.round(73 * e) + '<span class="text-lg">ms</span>';
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  }, 600);

  // t=1750ms: القرار — GEO_VELOCITY_IMPOSSIBLE → FREEZE
  later(() => {
    $('arcDistance').setAttribute('opacity', '1');
    $('mapVerdict').classList.remove('hidden');
    $('londonDot').classList.add('attacker-flash'); // وميض أحمر
  }, 1750);

  // t=3200ms: عقدة المهاجم «تموت» (تُقفل) + جهاز العميل يطلب التحقّق
  later(() => {
    const dot = $('londonDot');
    dot.classList.remove('attacker-flash');
    dot.setAttribute('fill', '#4a5266');
    dot.style.filter = 'none';
    $('londonLock').setAttribute('opacity', '1');
    const halo = $('riyadhHalo');
    halo.setAttribute('opacity', '1');
    halo.classList.add('cust-verify');
    $('riyadhVerify').setAttribute('opacity', '1');
  }, 3200);

  // t=3400ms: حقن المعاملة الاحتيالية في التدفّق + فتح تحليلها في المحرك
  later(() => {
    const txn = finalizeTxn({ ...FRAUD_TXN, dims: { ...FRAUD_TXN.dims }, reasons: [...FRAUD_TXN.reasons] });
    pushTxn(txn);
    selectTxn(txn.id);
  }, 3400);

  // t=4700ms: فتح مودال التحقّق المتدرّج (Tier 1)
  later(() => {
    const txn = state.transactions.find((x) => x.id === FRAUD_TXN.id);
    if (txn) openModal(txn);
  }, 4700);
}

/* ---------- سيناريو 2: الإنذار الكاذب (دبي) — مقارنة ---------- */
function addStep(containerId, html, cls = '') {
  const el = document.createElement('div');
  el.className = `step-in glass-inner px-3 py-2 text-sm ${cls}`;
  el.innerHTML = html;
  $(containerId).appendChild(el);
}

function runFalsePositiveScenario() {
  clearScenarioTimers();
  closeModal(true);
  state.wasFeedRunning = !state.feedPaused;
  setFeedPaused(true);

  // إعادة تهيئة المسرحين
  $('legacyStage').innerHTML = '';
  $('radarStage').innerHTML = '';
  $('legacyResult').classList.add('hidden');
  $('radarResult').classList.add('hidden');
  $('legacyCost').textContent = '0.00';
  $('compareSection').scrollIntoView({ behavior: 'smooth', block: 'center' });

  // حقن معاملة دبي في التدفّق وفتح تحليلها (composite 45 → REVIEW)
  later(() => {
    const txn = finalizeTxn({ ...FP_TXN, dims: { ...FP_TXN.dims }, reasons: [...FP_TXN.reasons] });
    pushTxn(txn);
    selectTxn(txn.id);
  }, 200);

  // نفس التمريرة تصل للطرفين
  later(() => { addStep('legacyStage', t('stSwipe')); addStep('radarStage', t('stSwipe')); }, 400);

  // ← البنك التقليدي: قاعدة صمّاء → حظر → مكالمة وكيل بـ 15 ريال
  later(() => addStep('legacyStage', t('stLegacyRule'), 'text-review'), 1300);
  later(() => {
    $('legacyResult').classList.remove('hidden');
    $('legacyResult').classList.add('step-in');
    countUp($('legacyCost'), 15, { dur: 1200, dec: 2 });
  }, 2200);
  later(() => addStep('legacyStage', t('stLegacyCall'), 'text-slate-400'), 2900);

  // → رادار: تقييم 73ms → تحقّق صامت بنقرتين → احتفاظ بالعميل
  later(() => addStep('radarStage', `<span class="num">${t('stRadarScore')}</span>`), 1300);
  later(() => addStep('radarStage', t('stRadarPush')), 2200);
  later(() => addStep('radarStage', t('stRadarTap'), 'text-safe'), 3000);
  later(() => {
    $('radarResult').classList.remove('hidden');
    $('radarResult').classList.add('step-in');
    // تتبّع «العملاء المحتفظ بهم» و«الإيراد المحمي»
    state.kpi.retained += 1;
    state.kpi.revenue += 8400;
    countUp($('cmpRetainedCount'), state.kpi.retained, { from: state.kpi.retained - 1, dur: 700 });
    countUp($('cmpRevenueCount'), state.kpi.revenue, { from: state.kpi.revenue - 8400, dur: 1000 });
    // وينعكس على KPI الرأس أيضًا
    state.kpi.falseAlarms += 1;
    state.kpi.costSaved += 14.95;
    $('kpiFalseAlarms').textContent = fmt(state.kpi.falseAlarms);
    $('kpiCostSaved').textContent = fmt(Math.round(state.kpi.costSaved));
  }, 3800);

  // استئناف التدفّق بعد اكتمال المشهد
  later(() => { if (state.wasFeedRunning) setFeedPaused(false); }, 5200);
}

/* ============================================================================
   مودال التحقّق الصامت المتدرّج — Tier 1 → 2 → 3
   ============================================================================ */
function setTierStep(active) {
  document.querySelectorAll('.tier-step').forEach((step) => {
    const n = Number(step.dataset.tier);
    const dot = step.querySelector('.tier-dot');
    if (n === active) {
      dot.style.borderColor = 'rgba(0,229,160,.7)';
      dot.style.color = '#00E5A0';
      dot.style.boxShadow = '0 0 14px rgba(0,229,160,.35)';
    } else if (n < active) {
      dot.style.borderColor = 'rgba(0,229,160,.35)';
      dot.style.color = 'rgba(0,229,160,.6)';
      dot.style.boxShadow = 'none';
      dot.textContent = '✓';
    } else {
      dot.style.borderColor = 'rgba(255,255,255,.2)';
      dot.style.color = '#e8ecf4';
      dot.style.boxShadow = 'none';
      dot.textContent = String(n);
    }
    if (n === active) dot.textContent = String(n);
  });
}

function showTier(n) {
  if (state.modalTimer) { clearTimeout(state.modalTimer); state.modalTimer = null; }
  [1, 2, 3].forEach((i) => $('tier' + i).classList.toggle('hidden', i !== n));
  setTierStep(n);
  if (n === 1) startTier1();
  if (n === 2) resetTier2();
}

/* Tier 1: تحقّق حيوي صامت — يُحسم خلال ~2 ثانية */
function startTier1() {
  const ring = $('faceRing');
  // إعادة تشغيل أنيميشن الحلقة (إزالة/إعادة الكلاس مع reflow)
  ring.classList.remove('faceid-ring');
  void ring.getBoundingClientRect();
  ring.classList.add('faceid-ring');
  $('faceScanLine').style.display = '';
  $('faceCheck').classList.add('hidden');
  $('tier1Verdict').classList.add('hidden');
  $('tier1Status').textContent = t('tier1Scanning');
  $('btnIgnorePush').classList.remove('hidden');

  state.modalTimer = setTimeout(() => {
    $('faceScanLine').style.display = 'none';
    $('faceCheck').classList.remove('hidden');
    $('tier1Status').textContent = t('tier1Done');
    $('tier1Verdict').classList.remove('hidden');
    $('btnIgnorePush').classList.add('hidden'); // حُسمت — لا حاجة للتصعيد
  }, 2000);
}

/* Tier 2: نفاذ — مطابقة رمز من رقمين (الرمز الصحيح: 42) */
function resetTier2() {
  $('tier2Verdict').classList.add('hidden');
  $('tier2Wrong').classList.add('hidden');
  document.querySelectorAll('.nafath-opt').forEach((b) => {
    b.disabled = false;
    b.classList.remove('shake');
    b.style.borderColor = '';
    b.style.color = '';
  });
}

function bindNafath() {
  document.querySelectorAll('.nafath-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.code === '42') {
        btn.style.borderColor = 'rgba(0,229,160,.7)';
        btn.style.color = '#00E5A0';
        $('tier2Wrong').classList.add('hidden');
        $('tier2Verdict').classList.remove('hidden');
        document.querySelectorAll('.nafath-opt').forEach((b) => (b.disabled = true));
      } else {
        btn.classList.remove('shake');
        void btn.getBoundingClientRect();
        btn.classList.add('shake');
        btn.style.borderColor = 'rgba(255,77,94,.6)';
        btn.style.color = '#FF4D5E';
        $('tier2Wrong').classList.remove('hidden');
      }
    });
  });
}

function openModal(txn) {
  // إن كان التدفّق موقوفًا سلفًا (سيناريو/يدويًا) نُبقي نيّة الاستئناف السابقة كما هي
  if (!state.feedPaused) state.wasFeedRunning = true;
  setFeedPaused(true);
  $('modalContext').textContent = `TXN #${txn.id} · ${fmt(txn.amount)} SAR`;
  $('verifyModal').classList.remove('hidden');
  $('tier3Verdict').classList.add('hidden');
  showTier(1);
}

function closeModal(silent = false) {
  const modal = $('verifyModal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  if (state.modalTimer) { clearTimeout(state.modalTimer); state.modalTimer = null; }
  if (!silent && state.wasFeedRunning) setFeedPaused(false);
}

/* ============================================================================
   8) BOOT — الربط والتشغيل
   ============================================================================ */
function boot() {
  // KPIs الافتتاحية
  initKpis();

  // تعبئة أولية للتدفّق ثم بث مستمر كل ~1.5s
  for (let i = 0; i < 6; i++) pushTxn(makeTxn(), { animate: false });
  state.feedTimer = setInterval(tickFeed, CONFIG.feedIntervalMs);

  // تهيئة القوس (يُخفى حتى تشغيل السيناريو)
  resetMapState();

  // اللغة
  $('langToggle').addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));

  // Dock
  $('btnScenarioFraud').addEventListener('click', runFraudScenario);
  $('btnScenarioFP').addEventListener('click', runFalsePositiveScenario);
  $('btnPauseFeed').addEventListener('click', () => {
    const paused = !state.feedPaused;
    state.wasFeedRunning = !paused; // اختيار المستخدم اليدوي يحسم نيّة الاستئناف
    setFeedPaused(paused);
  });
  $('btnRunCompare').addEventListener('click', runFalsePositiveScenario);

  // المودال
  $('modalClose').addEventListener('click', () => closeModal());
  $('verifyModal').addEventListener('click', (e) => { if (e.target === $('verifyModal')) closeModal(); });
  $('btnIgnorePush').addEventListener('click', () => showTier(2));
  $('btnNoNafath').addEventListener('click', () => showTier(3));
  $('btnTier3App').addEventListener('click', () => $('tier3Verdict').classList.remove('hidden'));
  bindNafath();
}

document.addEventListener('DOMContentLoaded', boot);
