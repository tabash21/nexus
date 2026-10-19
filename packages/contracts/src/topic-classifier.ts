export const TOPIC_IDS = [
  'security_defense',
  'politics_governance',
  'diplomacy_relations',
  'crime_policing',
  'economy_business',
  'infrastructure_transport',
  'health',
  'humanitarian_displacement',
  'society_public_services',
  'environment_disasters',
  'technology_cyber',
  'other',
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

export const TOPIC_CONCEPT_WEIGHTS = {
  high: 0.8,
  strong: 0.4,
  weak: 0.15,
} as const;

export type ConceptWeight = keyof typeof TOPIC_CONCEPT_WEIGHTS;

export interface TopicConceptConfig {
  id: string;
  weight: ConceptWeight;
  patterns: readonly string[];
}

export interface TopicCatalogEntry {
  topic_id: Exclude<TopicId, 'other'> | 'other';
  name: string;
  description: string;
  concepts: readonly TopicConceptConfig[];
}

export interface TopicAssignment {
  topicId: TopicId;
  score: number;
  conceptIds: string[];
}

export const TOPIC_CATALOG: readonly TopicCatalogEntry[] = [
  {
    topic_id: 'security_defense',
    name: 'Security & defense',
    description: 'Military operations, armed attacks, weapons, and military preparedness.',
    concepts: [
      {
        id: 'security_airstrike',
        weight: 'high',
        patterns: ['airstrike', 'missile strike', 'rocket attack', 'bombing', 'armed attack', 'military operation', 'air raid', 'helicopter strike', 'הפצצה', 'פצצה', 'שיגור טיל', 'התקפה על בסיס', 'ضربة جوية', 'هجوم عسكري', 'قصف', 'عملية عسكرية'],
      },
      {
        id: 'security_weapons',
        weight: 'strong',
        patterns: ['weapon', 'weapons', 'rocket', 'missile', 'explosive', 'military base', 'armed forces', 'combat', 'artillery', 'נשק', 'רקטה', 'טיל', 'בסיס צבאי', 'כוחות צבא', 'أسلحة', 'قوات عسكرية', 'قاعدة عسكرية'],
      },
      {
        id: 'security_prep',
        weight: 'weak',
        patterns: ['mobilization', 'military alert', 'defense readiness', 'reserve deployment', 'היערכות צבאית', 'מוכנות ביטחונית', 'استعدادات عسكرية', 'نشر عسكري'],
      },
    ],
  },
  {
    topic_id: 'politics_governance',
    name: 'Politics & governance',
    description: 'Elections, parties, political appointments, government decisions, and institutional disputes.',
    concepts: [
      {
        id: 'politics_election',
        weight: 'high',
        patterns: ['election', 'presidential election', 'parliament vote', 'party leadership', 'governance decision', 'government move', 'בחירות', 'הצבעה פרלמנטרית', 'ממשלת', 'انتخابات', 'حكومة', 'تصويت برلماني'],
      },
      {
        id: 'politics_party',
        weight: 'strong',
        patterns: ['party', 'coalition', 'cabinet', 'government ministry', 'minister', 'legislature', 'political appointment', 'מפלגה', 'קואליציה', 'ממשלה', 'שר', 'פרלמנט', 'حزب', 'حكومة', 'وزير', 'برلمان'],
      },
      {
        id: 'politics_public',
        weight: 'weak',
        patterns: ['public service', 'policy announcement', 'municipal budget', 'city hall', 'school reopening', 'שירות ציבורי', 'הודעת ממשלה', 'خدمة عامة', 'إعلان حكومي'],
      },
    ],
  },
  {
    topic_id: 'diplomacy_relations',
    name: 'Diplomacy & relations',
    description: 'Negotiations, treaties, sanctions, diplomatic recognition, and international organizations.',
    concepts: [
      {
        id: 'diplomacy_treaty',
        weight: 'high',
        patterns: ['treaty', 'summit', 'peace agreement', 'sanctions', 'diplomatic recognition', 'negotiation', 'international mediation', 'הסכם', 'שיחות דיפלומטיות', 'סנקציות', 'הכרה דיפלומטית', 'مفاوضات', 'معاهدة', 'تسوية', 'عقوبات', 'محادثات دبلوماسية'],
      },
      {
        id: 'diplomacy_org',
        weight: 'strong',
        patterns: ['united nations', 'eu', 'arab league', 'embassy', 'foreign ministry', 'ambassador', 'consulate', 'האו"ם', 'שגרירות', 'משרד חוץ', 'الامم المتحدة', 'سفارة', 'وزارة الخارجية', 'مبعوث'],
      },
      {
        id: 'diplomacy_visit',
        weight: 'weak',
        patterns: ['official visit', 'state visit', 'delegation', 'foreign minister', 'ביקור רשמי', 'שליח', 'زيارة رسمية', 'وفد'],
      },
    ],
  },
  {
    topic_id: 'crime_policing',
    name: 'Crime & policing',
    description: 'Criminal investigations, arrests, organized crime, and policing.',
    concepts: [
      {
        id: 'crime_arrest',
        weight: 'high',
        patterns: ['arrest', 'detention', 'criminal investigation', 'police raid', 'coordinated crackdown', 'charged with', 'ה arrest', 'מעצר', 'חקירה פלילית', 'משטרת', 'מעצר', 'اعتقال', 'دوريات', 'تحقيق جنائي', 'شرطة'],
      },
      {
        id: 'crime_organized',
        weight: 'strong',
        patterns: ['organized crime', 'drug trafficking', 'smuggling ring', 'fraud case', 'money laundering', 'cartel', 'פשיעה מאורגנת', 'סחר בסמים', 'הלבנת הון', 'جريمة منظمة', 'تهريب', 'مخدرات', 'غسيل أموال'],
      },
      {
        id: 'crime_police',
        weight: 'weak',
        patterns: ['police', 'security forces', 'investigator', 'officer', 'שוטרים', 'חוקר', 'منشأة أمنية', 'ضابط شرطة', 'شرطة'],
      },
    ],
  },
  {
    topic_id: 'economy_business',
    name: 'Economy & business',
    description: 'Inflation, employment, budgets, trade, companies, and financial markets.',
    concepts: [
      {
        id: 'economy_prices',
        weight: 'high',
        patterns: ['inflation', 'price surge', 'budget deficit', 'trade agreement', 'employment data', 'market crash', 'monetary policy', 'אינפלציה', 'חוב ציבורי', 'תקציב', 'שווקים', 'תעסוקה', 'التضخم', 'ميزانية', 'أسعار', 'توظيف', 'سوق'],
      },
      {
        id: 'economy_business',
        weight: 'strong',
        patterns: ['company', 'factory', 'shipping', 'trade', 'bank', 'stock market', 'currency', 'startup', 'חברה', 'מפעל', 'חנות', 'בנק', 'שוק המניות', 'شركة', 'مصنع', 'بنك', 'تجارة'],
      },
      {
        id: 'economy_jobs',
        weight: 'weak',
        patterns: ['jobs', 'wages', 'pay rises', 'salary', 'employment', 'משרות', 'שכר', 'תעסוקה', 'وظائف', 'رواتب'],
      },
    ],
  },
  {
    topic_id: 'infrastructure_transport',
    name: 'Infrastructure & transport',
    description: 'Roads, rail, aviation, electricity, water, communications networks, and outages.',
    concepts: [
      {
        id: 'infra_roads',
        weight: 'high',
        patterns: ['road closure', 'rail line', 'airport shutdown', 'power outage', 'water outage', 'network outage', 'bridge collapse', 'סגירת כביש', 'תחנת רכבת', 'שיבוש תנועה', 'חשמל', 'מים', 'רשת', 'נמל', 'أزمة كهرباء', 'إغلاق طريق', 'انقطاع كهرباء', 'شبكة', 'قطار'],
      },
      {
        id: 'infra_transport',
        weight: 'strong',
        patterns: ['railway', 'aviation', 'ports', 'electric grid', 'water system', 'pipeline', 'telecom network', 'תחבורה', 'מסילת ברזל', 'שדה תעופה', 'בזק', 'רכבת', 'نقل', 'شبكة اتصالات', 'خط أنابيب'],
      },
      {
        id: 'infra_service',
        weight: 'weak',
        patterns: ['roadworks', 'maintenance', 'signal failure', 'power line', 'שיפוץ', 'תחזוקה', 'תקלת רשת', 'صيانة', 'شبكة كهرباء'],
      },
    ],
  },
  {
    topic_id: 'health',
    name: 'Health',
    description: 'Disease, hospitals, healthcare, and public-health measures.',
    concepts: [
      {
        id: 'health_disease',
        weight: 'high',
        patterns: ['outbreak', 'epidemic', 'disease', 'hospital', 'clinic', 'health emergency', 'vaccination', 'מגיפה', 'מחלה', 'בית חולים', 'חיסון', 'תחלואה', 'وباء', 'مرض', 'مستشفى', 'لقاح', 'صحة عامة'],
      },
      {
        id: 'health_system',
        weight: 'strong',
        patterns: ['healthcare', 'medical staff', 'medical center', 'public health', 'nurse', 'doctor', 'בריאות', 'רופאים', 'חדר מיון', 'رعاية صحية', 'طبيب', 'ممرض', 'صحة'],
      },
      {
        id: 'health_measures',
        weight: 'weak',
        patterns: ['screening', 'quarantine', 'testing', 'mask mandate', 'אבחון', 'בידוד', 'בדיקות', 'تطعيم', 'حجر صحي'],
      },
    ],
  },
  {
    topic_id: 'humanitarian_displacement',
    name: 'Humanitarian & displacement',
    description: 'Humanitarian aid, displacement, refugees, shelter, and access to essential supplies.',
    concepts: [
      {
        id: 'humanitarian_refugees',
        weight: 'high',
        patterns: ['refugee camp', 'displaced persons', 'shelter', 'humanitarian aid', 'food assistance', 'evacuation', 'פליטים', 'מחנה פליטים', 'מקלט', 'סיוע הומניטרי', 'התפנות', 'لاجئين', 'مخيمات', 'مساعدات إنسانية', 'إخلاء', 'مأوى'],
      },
      {
        id: 'humanitarian_access',
        weight: 'strong',
        patterns: ['aid delivery', 'food supplies', 'clean water', 'medical aid', 'blockade', 'access to shelter', 'אספקת מזון', 'מים נקיים', 'סיוע רפואי', 'הגבלת גישה', 'مساعدات غذائية', 'ماء', 'أدوية', 'وصول'],
      },
      {
        id: 'humanitarian_support',
        weight: 'weak',
        patterns: ['relief', 'assistance', 'support services', 'welfare', 'סיוע', 'עזרה', 'مساعدة', 'دعم'],
      },
    ],
  },
  {
    topic_id: 'society_public_services',
    name: 'Society & public services',
    description: 'Education, housing policy, social welfare, community relations, and access to public services.',
    concepts: [
      {
        id: 'society_education',
        weight: 'high',
        patterns: ['school closure', 'education ministry', 'housing program', 'public housing', 'social welfare', 'community support', 'שביתת בתי ספר', 'חינוך', 'דיור ציבורי', 'רווחה', 'שירותים ציבוריים', 'المدارس', 'التعليم', 'السكن', 'الرعاية الاجتماعية'],
      },
      {
        id: 'society_services',
        weight: 'strong',
        patterns: ['public service', 'housing policy', 'welfare payments', 'community center', 'transport subsidy', 'שירות ציבורי', 'תמיכה קהילתית', 'דיור', 'רווחה', 'مرافق عامة', 'خدمة عامة', 'إسكان', 'خدمات اجتماعية'],
      },
      {
        id: 'society_family',
        weight: 'weak',
        patterns: ['family', 'school', 'community', 'families', 'משפחה', 'מוסד חינוכי', 'קהילה', 'أسرة', 'مدرسة'],
      },
    ],
  },
  {
    topic_id: 'environment_disasters',
    name: 'Environment & disasters',
    description: 'Extreme weather, earthquakes, wildfires, pollution, and environmental hazards.',
    concepts: [
      {
        id: 'environment_weather',
        weight: 'high',
        patterns: ['flood', 'wildfire', 'earthquake', 'heatwave', 'storm surge', 'pollution crisis', 'שיטפון', 'שריפה', 'רעידת אדמה', 'גל חום', 'סופת חורף', 'فيضانات', 'حرائق', 'زلزال', 'موجة حر', 'تلوث', 'عاصفة'],
      },
      {
        id: 'environment_hazard',
        weight: 'strong',
        patterns: ['hazardous spill', 'air pollution', 'chemical leak', 'drought', 'smoke', 'soil contamination', 'זיהום אוויר', 'דליפת כימיקלים', 'בצורת', 'עשן', 'تلوث الهواء', 'تسرب كيميائي', 'جفاف'],
      },
      {
        id: 'environment_response',
        weight: 'weak',
        patterns: ['evacuation order', 'firefighters', 'rescue', 'emergency response', 'פינוי', 'כיבוי אש', 'חילוץ', 'استجابة طوارئ'],
      },
    ],
  },
  {
    topic_id: 'technology_cyber',
    name: 'Technology & cyber',
    description: 'Cyberattacks, data breaches, vulnerabilities, and substantive technology developments.',
    concepts: [
      {
        id: 'tech_cyber_attack',
        weight: 'high',
        patterns: ['cyberattack', 'ransomware', 'data breach', 'hacking incident', 'vulnerability exploited', 'malware', 'computer network attack', 'התקפת סייבר', 'פרצת נתונים', 'כופר', 'התקפה דיגיטלית', 'فيروس', 'هجوم سيبراني', 'اختراق', 'برمجيات خبيثة', 'اختراق بيانات'],
      },
      {
        id: 'tech_dev',
        weight: 'strong',
        patterns: ['software patch', 'network outage', 'vulnerability', 'digital infrastructure', 'tech startup', 'algorithm update', 'עדכון תוכנה', 'פרצות אבטחה', 'תשתית דיגיטלית', 'تحديث برمجي', 'ثغرة أمنية', 'تكنولوجيا'],
      },
      {
        id: 'tech_weak',
        weight: 'weak',
        patterns: ['telegram', 'phone', 'app', 'mobile', 'smartphone', 'טלגרם', 'מכשיר', 'هاتف', 'تطبيق'],
      },
    ],
  },
  {
    topic_id: 'other',
    name: 'Other',
    description: 'Fallback when no configured substantive topic qualifies.',
    concepts: [],
  },
] as const;

const normalizeDirectory = new Map<string, string>([['ا', 'ا'], ['أ', 'ا'], ['إ', 'ا'], ['آ', 'ا'], ['ٱ', 'ا'], ['ى', 'ي'], ['ة', 'ة'], ['ئ', 'ي'], ['ؤ', 'و'], ['ى', 'ي']]);

function normalizeClassifierText(value: string): string {
  if (!value) return '';
  let output = value.normalize('NFC').replace(/\r\n?/g, '\n');
  output = output.replace(/https?:\/\/[^\s]+/gi, ' ');
  output = output.replace(/www\.[^\s]+/gi, ' ');
  output = output.replace(/[\u0591-\u05C7]/g, '');
  output = output.replace(/[\u064B-\u065F\u0670]/g, '');
  output = output.replace(/[\u0640]/g, '');
  for (const [source, target] of normalizeDirectory) {
    output = output.replace(new RegExp(source, 'g'), target);
  }
  output = output.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return output.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldMatchesPattern(field: string, pattern: string): boolean {
  const normalizedField = normalizeClassifierText(field);
  const normalizedPattern = normalizeClassifierText(pattern);
  if (!normalizedField || !normalizedPattern) return false;
  const boundaryPattern = `(^|[^\\p{L}\\p{N}])${escapeRegex(normalizedPattern).replace(/\s+/g, '[\\s\\u00A0]+')}(?=$|[^\\p{L}\\p{N}])`;
  return new RegExp(boundaryPattern, 'giu').test(normalizedField);
}

function conceptMatches(fieldText: string | null | undefined, concept: TopicConceptConfig): boolean {
  if (!fieldText) return false;
  return concept.patterns.some(pattern => fieldMatchesPattern(fieldText, pattern));
}

export function classifyItemTopics(title?: string | null, body?: string | null): TopicAssignment[] {
  const titleText = typeof title === 'string' ? title : '';
  const bodyText = typeof body === 'string' ? body : '';
  if (!normalizeClassifierText(titleText) && !normalizeClassifierText(bodyText)) {
    return [{ topicId: 'other', score: 0, conceptIds: [] }];
  }

  const matches: TopicAssignment[] = [];

  for (const topic of TOPIC_CATALOG) {
    if (topic.topic_id === 'other') continue;

    const matchedConcepts = new Map<string, ConceptWeight>();
    for (const concept of topic.concepts) {
      if (conceptMatches(titleText, concept) || conceptMatches(bodyText, concept)) {
        matchedConcepts.set(concept.id, concept.weight);
      }
    }

    if (matchedConcepts.size === 0) continue;

    const scoreValue = Math.min(
      Object.values(TOPIC_CONCEPT_WEIGHTS)
        .reduce((sum, weight) => sum + weight, 0),
      1,
    );

    const weights = [...matchedConcepts.values()].map(weight => TOPIC_CONCEPT_WEIGHTS[weight]);
    const score = Number(Math.min(weights.reduce((sum, weight) => sum + weight, 0), 1).toFixed(4));
    const hasHigh = [...matchedConcepts.values()].some(weight => weight === 'high');
    const strongCount = [...matchedConcepts.values()].filter(weight => weight === 'strong').length;

    if (score >= 0.8 && (hasHigh || strongCount >= 2)) {
      matches.push({
        topicId: topic.topic_id,
        score,
        conceptIds: [...matchedConcepts.keys()],
      });
    }
  }

  const sorted = matches.sort((a, b) => a.topicId.localeCompare(b.topicId));
  if (sorted.length > 0) return sorted;
  return [{ topicId: 'other', score: 0, conceptIds: [] }];
}

export function validateTopicCatalog(catalog: readonly TopicCatalogEntry[]): void {
  if (!catalog.length) {
    throw new Error('Topic catalog is empty');
  }
  const topicIds = new Set<string>();
  for (const topic of catalog) {
    if (topic.topic_id === 'other') {
      if (topic.concepts.length > 0) {
        throw new Error('The other topic must not define keyword patterns');
      }
    }
    if (topicIds.has(topic.topic_id)) {
      throw new Error(`Duplicate topic definition: ${topic.topic_id}`);
    }
    topicIds.add(topic.topic_id);
    for (const concept of topic.concepts) {
      if (!concept.id || !concept.patterns.length) {
        throw new Error(`Invalid concept definition for ${topic.topic_id}`);
      }
      for (const pattern of concept.patterns) {
        if (!normalizeClassifierText(pattern)) {
          throw new Error(`Empty pattern in ${topic.topic_id}/${concept.id}`);
        }
      }
    }
  }
  if (!TOPIC_IDS.includes('other')) {
    throw new Error('The other fallback topic must be present');
  }
}

validateTopicCatalog(TOPIC_CATALOG);
