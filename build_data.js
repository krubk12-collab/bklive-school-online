// ดึงตารางสอนจริง ป.1-6 จาก timetable_p13/p46.html → data.js
// รัน: node build_data.js
const fs = require('fs');
const SRC = [
  '../timetable/timetable_p13.html',
  '../timetable/timetable_p46.html',
];

function extract(file) {
  const s = fs.readFileSync(file, 'utf8');
  const T    = eval('(' + s.match(/const T = ({[\s\S]*?});/)[1] + ')');
  const CL   = eval('(' + s.match(/const CL_MAP = ({[\s\S]*?});/)[1] + ')');
  const AREA = eval('(' + s.match(/const AREA_OF = ({[\s\S]*?});/)[1] + ')');
  const SCH  = eval(s.match(/const SCH_RAW = (\[[\s\S]*?\n\]);/)[1]);
  return { T, CL, AREA, SCH };
}

// กลุ่มสาระ → index สีในเกม (ตรงกับ GROUPS ใน index.html)
const GROUP_IDX = {
  'ภาษาไทย':0,'คณิตศาสตร์':1,'วิทยาศาสตร์และเทคโนโลยี':2,'สังคมศึกษาฯ':3,
  'สุขศึกษาและพลศึกษา':4,'ศิลปะ':5,'การงานอาชีพ':6,'ภาษาต่างประเทศ':7,
};

const teachers = {};   // name → {name, disp, areas:{}}
const tt = {};         // name → {day: {period: {s, c}}}
const classes = {};    // classId → label
let conflicts = 0;

for (const f of SRC) {
  const { T, CL, AREA, SCH } = extract(f);
  Object.assign(classes, CL);
  for (const [cls, subj, keys, day, per] of SCH) {
    for (const k of keys.split('+')) {
      const name = T[k.trim()];
      if (!name) { console.error('ไม่รู้จักครู:', k, 'ใน', f); continue; }
      if (!teachers[name]) {
        const tok = name.split(' ')[0];
        teachers[name] = { name, disp: tok === 'Mr.' ? 'Mr.' + name.split(' ')[1] : 'ครู' + tok, areas: {} };
      }
      const area = AREA[subj];
      if (area && GROUP_IDX[area] !== undefined)
        teachers[name].areas[area] = (teachers[name].areas[area] || 0) + 1;
      tt[name] = tt[name] || {};
      tt[name][day] = tt[name][day] || {};
      if (tt[name][day][per] && tt[name][day][per].c !== cls) {
        conflicts++;
        console.warn(`⚠️ ชนกัน: ${name} วัน${day} คาบ${per}: ${tt[name][day][per].c} vs ${cls} (เก็บอันแรก)`);
        continue;
      }
      tt[name][day][per] = { s: subj, c: cls };
    }
  }
}

// กลุ่มสาระหลักของครู = วิชาที่สอนมากสุด
const list = Object.values(teachers).map(t => {
  const top = Object.entries(t.areas).sort((a, b) => b[1] - a[1])[0];
  return { name: t.name, disp: t.disp, group: top ? GROUP_IDX[top[0]] : 3 };
});

const out = 'const SCHOOL=' + JSON.stringify({
  teachers: list,
  classes,
  tt,
}) + ';\n';
fs.writeFileSync('data.js', out, 'utf8');

// self-check
const nSlots = Object.values(tt).reduce((a, d) =>
  a + Object.values(d).reduce((b, p) => b + Object.keys(p).length, 0), 0);
console.log(`✅ ครู ${list.length} คน · ห้องเรียน ${Object.keys(classes).length} ห้อง · คาบสอนรวม ${nSlots} · ชนกัน ${conflicts}`);
if (list.length < 25 || nSlots < 300) { console.error('❌ ข้อมูลน้อยผิดปกติ'); process.exit(1); }
