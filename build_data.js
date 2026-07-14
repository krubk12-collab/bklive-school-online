// ดึงตารางสอนจริงทั้งหมดสดจาก Google Sheets → data.js
// ประถม = แท็บ "ตารางประถม" ใน SCHEDULE_SS (import ครั้งแรกด้วย scratchpad/import_primary.js ผ่าน timetable_log GAS)
// รัน: NODE_OPTIONS=--use-system-ca node build_data.js  (เครื่องนี้ fetch google ต้องใช้ system CA)
const fs = require('fs');
const SHEET = {
  teachers: 'https://docs.google.com/spreadsheets/d/1HZw5GndLG3EE4odpPiOX8ucGq8PpovBomULgUZVn3Yo/gviz/tq?tqx=out:csv',
  subjects: 'https://docs.google.com/spreadsheets/d/1BYF9tLnaBX9IHXafD32i1s21NOlnYQKPgIrXoLI8asU/gviz/tq?tqx=out:csv',
  schedule: 'https://docs.google.com/spreadsheets/d/14ZyWxubxyrpJN3GGN8YE8llP6ynZHHMOHyzrh3v6sng/gviz/tq?tqx=out:csv',
};
const M_CLASSES = { C17:'ม.1/1', C18:'ม.1/2', C19:'ม.2/1', C20:'ม.2/2', C21:'ม.3/1', C22:'ม.3/2' };
// นักเรียนจริง: MASTER + YEARLY (โครงสร้างชีตโรงเรียน: แถว1 title, แถว2 header, แถว3 คำอธิบาย, แถว4+ ข้อมูล)
const MASTER_ID = '16usk65fYdcUmHLhzEIQmQVYY8A_IW-UFgY7kPis5pPo';
const YEARLY_ID = '14MamZ_Uy4hFRweJRTL_bW8PMEntEk_q0srmPQD5bU78';
const gviz = (id, sheet) => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${sheet}`;
const SHEET_STU = {
  students: gviz(MASTER_ID, 'Students'),
  classes:  gviz(MASTER_ID, 'Classes'),
  enroll:   gviz(YEARLY_ID, 'Enrollment'),
};
// ห้องพิเศษมัธยม (กติกาเดียวกับ timetable.html + regex ชื่อวิชากันตกหล่น)
const DOME_SIDS = new Set(['SB009','SB027','SB045']);
const COMP_SIDS = new Set(['SB014','SB015','SB032','SB033','SB050','SB055']);
const T013_EXCL = new Set(['SB056','SB057','SB058']);
function mRoom(sid, tid, name) {
  if (DOME_SIDS.has(sid) || /พลศึกษา|ลูกเสือ/.test(name)) return 'dome';
  if (tid === 'T013' && !T013_EXCL.has(sid)) return 'm_comp';
  if (COMP_SIDS.has(sid) || /วิทยาการคำนวณ|คอมพิวเตอร์|เทคโนโลยี/.test(name)) return 'm_comp';
  if (/^วิทยาศาสตร์|^ฉลาดรู้/.test(name)) return 'm_sci';
  return null;
}

// กลุ่มสาระ → index สีในเกม (ตรงกับ GROUPS ใน index.html)
const GROUP_IDX = {
  'ภาษาไทย':0,'คณิตศาสตร์':1,'วิทยาศาสตร์และเทคโนโลยี':2,'สังคมศึกษาฯ':3,
  'สุขศึกษาและพลศึกษา':4,'ศิลปะ':5,'การงานอาชีพ':6,'ภาษาต่างประเทศ':7,
};

const parseLine = line => {
  const cells = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  cells.push(cur.trim()); return cells;
};
function parseCSV(text) { // แถวแรก = header → objects
  const lines = text.trim().split(/\r?\n/);
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(l => {
    const v = parseLine(l), o = {};
    headers.forEach((h, i) => o[h] = v[i] || '');
    return o;
  }).filter(r => r[headers[0]]);
}
const csvRaw = text => text.trim().split(/\r?\n/).map(parseLine); // ดิบเป็น array (ชีตโรงเรียนใช้ index)

const teachers = {};  // name → {name, areas:{}, lvCnt:[ป.1-3, ป.4-6, ม.]}
const ttP = {}, ttM = {};  // ครู → วัน → คาบ → {s,c,r?}
const ctP = {}, ctM = {};  // ห้อง → วัน → คาบ → {s,r?}   (นักเรียนใช้ตาม)
const classes = {};
let conflicts = 0;

function touch(name) {
  if (!teachers[name]) {
    const tok = name.split(' ')[0];
    teachers[name] = {
      name,
      disp: /^[A-Za-z.]/.test(tok) ? 'Mr.' + name.split(' ')[tok === 'Mr.' ? 1 : 0] : 'ครู' + tok,
      areas: {}, lvCnt: [0, 0, 0],
    };
  }
  return teachers[name];
}
function addSlot(tt, name, day, per, val) {
  tt[name] = tt[name] || {}; tt[name][day] = tt[name][day] || {};
  const old = tt[name][day][per];
  if (old && old.c !== val.c) {
    conflicts++;
    console.warn(`⚠️ ชนกัน: ${name} วัน${day} คาบ${per}: ${old.c} vs ${val.c} (เก็บอันแรก)`);
    return;
  }
  tt[name][day][per] = val;
}

// ---- ทุกอย่างสดจาก Google Sheets ----
async function main() {
  const fetchCSV = (u, raw) => fetch(u)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return r.text(); })
    .then(raw ? csvRaw : parseCSV);
  const [tR, sR, schR, pR] = await Promise.all([
    fetchCSV(SHEET.teachers), fetchCSV(SHEET.subjects), fetchCSV(SHEET.schedule),
    fetchCSV(SHEET.schedule + '&sheet=' + encodeURIComponent('ตารางประถม')),
  ]);

  // ---- ประถม (แท็บ "ตารางประถม": class_id,class_name,day_of_week,period,subject_name,learning_area,teacher_name,is_active) ----
  for (const r of pR) {
    if (r.is_active !== 'TRUE') continue;
    const pid = 'P' + r.class_name.replace(/[^0-9]/g, ''); // ป.1/1 → P11
    classes[pid] = r.class_name;
    const day = +r.day_of_week, per = +r.period;
    ctP[pid] = ctP[pid] || {}; ctP[pid][day] = ctP[pid][day] || {};
    ctP[pid][day][per] = ctP[pid][day][per] || { s: r.subject_name };
    const t = touch(r.teacher_name);
    t.lvCnt[r.class_id <= 'C10' ? 0 : 1]++; // C05-C10 = ป.1-3 (ช่วงชั้น 1)
    if (GROUP_IDX[r.learning_area] !== undefined) t.areas[r.learning_area] = (t.areas[r.learning_area] || 0) + 1;
    addSlot(ttP, r.teacher_name, day, per, { s: r.subject_name, c: pid });
  }
  const T = {}; tR.forEach(r => { if (/^T\d+$/.test(r.teacher_id)) T[r.teacher_id] = `${r.first_name} ${r.last_name}`.trim(); });
  const S = {}; sR.forEach(r => { if (/^SB\d+$/.test(r.subject_id)) S[r.subject_id] = { n: r.subject_name, a: r.learning_area || '' }; });
  Object.assign(classes, M_CLASSES);
  let mSlots = 0;
  let unknown = 0;
  for (const r of schR) {
    if (r.is_active !== 'TRUE' || !r.subject_id || !r.teacher_id) continue;
    if (!M_CLASSES[r.class_id]) continue; // ชีตมีแถว C11-C16 (คาบประถมของครูควบ) ปน — เอาเฉพาะ ม.
    const name = T[r.teacher_id];
    const si = S[r.subject_id] || { n: 'กิจกรรม', a: 'กิจกรรมพัฒนาผู้เรียน' };
    const day = +r.day_of_week, per = +r.period;
    const room = mRoom(r.subject_id, r.teacher_id, si.n);
    const val = { s: si.n, c: r.class_id }; if (room) val.r = room;
    ctM[r.class_id] = ctM[r.class_id] || {}; ctM[r.class_id][day] = ctM[r.class_id][day] || {};
    ctM[r.class_id][day][per] = ctM[r.class_id][day][per] || val; // นักเรียนตามตารางห้องเสมอ
    if (!name) { unknown++; continue; }
    const t = touch(name);
    t.lvCnt[2]++;
    if (GROUP_IDX[si.a] !== undefined) t.areas[si.a] = (t.areas[si.a] || 0) + 1;
    addSlot(ttM, name, day, per, val);
    mSlots++;
  }
  if (unknown) console.warn(`⚠️ ครูที่ไม่รู้จักทั้งสองทะเบียน: ข้าม ${unknown} แถว`);

  // เช็คครูสอนควบชนกันข้ามระดับ (คาบสองระบบเวลาเหลื่อมกัน — เกมให้คาบ ม. ชนะ)
  const P_WIN = {2:[510,570],3:[570,630],4:[630,690],5:[750,810],6:[810,870],7:[870,930]};
  const M_WIN = {1:[510,560],2:[560,610],3:[610,660],4:[660,710],5:[770,820],6:[820,870],7:[870,930],8:[930,990]};
  let xz = 0;
  for (const name in ttM) {
    if (!ttP[name]) continue;
    for (let d = 1; d <= 5; d++) {
      for (const mp in (ttM[name][d] || {})) {
        const [ms, me] = M_WIN[mp];
        for (const pp in (ttP[name][d] || {})) {
          const [ps, pe] = P_WIN[pp];
          if (ms < pe && ps < me) { xz++;
            console.warn(`⚠️ ครูควบชนเวลา: ${name} วัน${d} ม.คาบ${mp}(${ttM[name][d][mp].s}) × ป.คาบ${pp}(${ttP[name][d][pp].s})`); }
        }
      }
    }
  }

  // ---- นักเรียนจริง ----
  const [stuR, clsR, enR] = await Promise.all(
    [SHEET_STU.students, SHEET_STU.classes, SHEET_STU.enroll].map(u =>
      fetch(u).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return r.text(); })
        .then(csvRaw)));
  const roomOfClass = {}; // class_id (C05..C22) → ห้องในเกม (P11..P62 / C17..C22)
  clsR.slice(3).forEach(r => {
    const [cid, , , name, , , active] = r;
    if (active !== 'TRUE') return;
    if (/^ป\./.test(name)) roomOfClass[cid] = 'P' + name.replace(/[^0-9]/g, '');
    else if (M_CLASSES[cid]) roomOfClass[cid] = cid; // อนุบาลไม่มีในแผนที่ → ข้าม
  });
  const stuMap = {}; stuR.slice(3).forEach(r => { if (r[0]) stuMap[r[0]] = { nick: r[6], first: r[4], g: r[7] }; });
  const students = [];
  enR.slice(3).forEach(r => {
    const [, stuId, cid, year, num, , , , st] = r;
    if (year !== '2569' || st !== 'active') return;
    const room = roomOfClass[cid], s = stuMap[stuId];
    if (!room || !s) return;
    students.push({ n: s.nick || s.first, c: room, g: /ช/.test(s.g) ? 0 : 1, no: +num || 0 });
  });
  students.sort((a, b) => a.c < b.c ? -1 : a.c > b.c ? 1 : a.no - b.no);

  // ครู: lv = ช่วงชั้นที่สอนมากสุด, group = กลุ่มสาระที่สอนมากสุด
  const list = Object.values(teachers).map(t => {
    const top = Object.entries(t.areas).sort((a, b) => b[1] - a[1])[0];
    const lv = t.lvCnt.indexOf(Math.max(...t.lvCnt));
    return { name: t.name, disp: t.disp, group: top ? GROUP_IDX[top[0]] : 3, lv };
  });

  fs.writeFileSync('data.js',
    'const SCHOOL=' + JSON.stringify({ teachers: list, classes, ttP, ttM, ctP, ctM, students }) + ';\n', 'utf8');

  // self-check
  const cnt = tt => Object.values(tt).reduce((a, d) =>
    a + Object.values(d).reduce((b, p) => b + Object.keys(p).length, 0), 0);
  const both = Object.values(teachers).filter(t => t.lvCnt[2] && (t.lvCnt[0] || t.lvCnt[1])).map(t => t.name);
  console.log(`✅ ครู ${list.length} คน (มัธยม ${list.filter(t => t.lv === 2).length}) · ห้อง ${Object.keys(classes).length}`);
  console.log(`   คาบประถม ${cnt(ttP)} · คาบมัธยม ${cnt(ttM)} (${mSlots} แถว) · ชนกัน ${conflicts}`);
  console.log(`   ครูสอนควบสองระดับ: ${both.join(', ') || 'ไม่มี'}`);
  const perRoom = {}; students.forEach(s => perRoom[s.c] = (perRoom[s.c] || 0) + 1);
  console.log(`   นักเรียนจริง ${students.length} คน · ${Object.keys(perRoom).length} ห้อง (${Object.entries(perRoom).map(([k, v]) => k + ':' + v).join(' ')})`);
  if (list.length < 35 || cnt(ttP) < 300 || cnt(ttM) < 200 || students.length < 300 || Object.keys(perRoom).length !== 18)
    { console.error('❌ ข้อมูลน้อยผิดปกติ'); process.exit(1); }
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
