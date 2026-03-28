import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, ShieldAlert, FileSpreadsheet } from "lucide-react";

/**
 * Приложение-калькулятор риска закупки.
 *
 * Логика основана на твоей методике из главы 2.2:
 * 1) Есть 3 этапа: предпроцедурный, процедурный, постпроцедурный.
 * 2) Для каждого этапа считаются:
 *    - P: вероятность (среднее значение баллов по критериям этапа)
 *    - I: значимость (среднее из F, S, L)
 *    - Kc: коррупционная уязвимость (только для 1 и 2 этапов)
 *    - M: управляемость
 *    - ΣZ: сумма бинарных индикаторов
 * 3) Формулы:
 *    R_plan = (P * I) * Kc / M + ΣZ
 *    R_proc = (P * I) * Kc / M + ΣZ
 *    R_exec = (P * I) / M + ΣZ
 * 4) Общий риск закупки = max(R_plan, R_proc, R_exec)
 *
 * Код написан максимально прозрачно:
 * - все критерии собраны в CONFIG
 * - расчёты идут в отдельных функциях
 * - интерфейс пошаговый
 */

const STEP_TITLES = [
  "Паспорт закупки",
  "Предпроцедурный этап",
  "Процедурный этап",
  "Постпроцедурный этап",
  "Результаты",
];

// -----------------------------
// 1. СПРАВОЧНИКИ
// -----------------------------

const SCORE_OPTIONS_1_5 = [1, 2, 3, 4, 5];
const SCORE_OPTIONS_1_3 = [1, 2, 3];

const STRATEGY_RULES = [
  {
    min: 0,
    max: 4.99,
    level: "Низкий",
    color: "bg-green-100 text-green-800",
    strategy: "Принятие риска",
    measures: [
      "Осуществлять закупку в стандартном режиме контроля.",
      "Проводить выборочную проверку документов и сроков.",
      "Фиксировать результаты для накопления базы аналогичных закупок.",
    ],
  },
  {
    min: 5,
    max: 9.99,
    level: "Средний",
    color: "bg-yellow-100 text-yellow-800",
    strategy: "Снижение риска",
    measures: [
      "Провести дополнительную проверку документации и расчёта Н(М)ЦК.",
      "Повторно проверить соответствие закупки требованиям законодательства.",
      "Уточнить состав комиссии и распределение ответственности.",
    ],
  },
  {
    min: 10,
    max: 19.99,
    level: "Высокий",
    color: "bg-orange-100 text-orange-800",
    strategy: "Усиленный контроль",
    measures: [
      "Назначить дополнительную правовую и финансовую экспертизу закупки.",
      "Усилить контроль со стороны контрактной службы и профильного подразделения.",
      "Проводить промежуточный мониторинг на наиболее рискованном этапе.",
    ],
  },
  {
    min: 20,
    max: Number.POSITIVE_INFINITY,
    level: "Критический",
    color: "bg-red-100 text-red-800",
    strategy: "Избежание или пересмотр закупки",
    measures: [
      "Пересмотреть параметры закупки, сроки, способ закупки и структуру лота.",
      "Передать закупку на уровень усиленного согласования с руководством.",
      "До проведения закупки устранить ключевые факторы риска.",
    ],
  },
];

const CORRUPTION_OPTIONS = [
  {
    value: 1.1,
    label: "Малая закупка на ЕАТ",
    description: "α = 0,1 → Kc = 1,1",
  },
  {
    value: 1.2,
    label: "Конкурентная закупка",
    description: "α = 0,2 → Kc = 1,2",
  },
  {
    value: 1.3,
    label: "Единственный поставщик",
    description: "α = 0,3 → Kc = 1,3",
  },
];

const CONFIG = {
  procurementInfo: [
    {
      key: "name",
      label: "Наименование закупки",
      type: "text",
      placeholder: "Например: Поставка серверного оборудования",
    },
    {
      key: "nmck",
      label: "Н(М)ЦК, руб.",
      type: "number",
      placeholder: "Например: 12500000",
    },
    {
      key: "object",
      label: "Предмет закупки",
      type: "text",
      placeholder: "Например: Товары / работы / услуги",
    },
  ],
  stages: {
    plan: {
      title: "Предпроцедурный этап",
      probabilityCriteria: [
        {
          key: "novelty",
          label: "Новизна предмета закупки",
          help: "1 — закупалось 5 и более раз за 2 года; 5 — не закупалось и нет аналогов.",
        },
        {
          key: "methodComplexity",
          label: "Сложность способа закупки",
          help: "1 — ЕАТ; 2 — запрос котировок; 3 — аукцион / ЕП; 4 — конкурс с 1 доп. критерием; 5 — конкурс с несколькими критериями.",
        },
        {
          key: "stagesDuration",
          label: "Этапность и длительность",
          help: "Оценивается по сложности исполнения и срокам закупки.",
        },
        {
          key: "regulation",
          label: "Законодательное регулирование",
          help: "Чем больше специальных требований, тем выше балл.",
        },
        {
          key: "planningUrgency",
          label: "Срочность планирования",
          help: "1 — плановый режим; 5 — экстренное планирование менее недели.",
        },
      ],
      indicators: [
        {
          key: "oldCommercialOffers",
          label: "Коммерческие предложения для Н(М)ЦК старше 5 месяцев",
        },
        {
          key: "recentLawChanges",
          label: "За 4 месяца до закупки были существенные изменения законодательства",
        },
        {
          key: "newResponsibleOfficer",
          label: "Ответственное должностное лицо ранее не участвовало в закупках",
        },
      ],
      stageMeasures: [
        "Дополнительно проверить обоснование Н(М)ЦК.",
        "Провести повторную правовую экспертизу способа закупки.",
        "Проверить описание объекта закупки на предмет избыточных требований.",
      ],
    },
    proc: {
      title: "Процедурный этап",
      probabilityCriteria: [
        {
          key: "evaluationComplexity",
          label: "Сложность критериев оценки",
          help: "1 — только цена; 5 — только неценовые критерии.",
        },
        {
          key: "marketCompetition",
          label: "Конкурентность рынка",
          help: "1 — высокая конкуренция; 5 — монопольный рынок.",
        },
        {
          key: "commissionExperience",
          label: "Опыт работы комиссии",
          help: "1 — все обучены и имеют опыт; 5 — новый состав, опыта нет.",
        },
        {
          key: "similarProcurementHistory",
          label: "Опыт проведения аналогичных закупок",
          help: "1 — без проблем; 5 — были обоснованные жалобы в ФАС.",
        },
        {
          key: "documentsCheck",
          label: "Проверка требуемых законодательством документов",
          help: "Чем больше специальных требований к документам, тем выше балл.",
        },
      ],
      indicators: [
        {
          key: "minimumCommission",
          label: "В состав комиссии входит только 3 человека",
        },
        {
          key: "highSecurityRequirements",
          label: "Требования к обеспечению выше обычно устанавливаемого уровня",
        },
        {
          key: "foreignBan1875",
          label: "Установлен запрет по Постановлению № 1875",
        },
      ],
      stageMeasures: [
        "Усилить правовую проверку извещения и критериев оценки.",
        "Проверить достаточность и компетенции состава комиссии.",
        "Провести внутреннюю проверку на предмет ограничения конкуренции.",
      ],
    },
    exec: {
      title: "Постпроцедурный этап",
      probabilityCriteria: [
        {
          key: "contractChanges",
          label: "Количество изменений контракта по предмету закупки или поставщику",
          help: "1 — изменений не было; 5 — 4 и более изменений либо расторжение.",
        },
        {
          key: "acceptanceComplexity",
          label: "Сложность приёмки",
          help: "1 — обычная приёмка по акту; 5 — с участием независимых экспертов.",
        },
        {
          key: "acceptanceCommissionExperience",
          label: "Опыт работы комиссии по приёмке",
          help: "1 — все обучены и имеют опыт; 5 — новый состав, опыта нет.",
        },
        {
          key: "warrantyDependence",
          label: "Гарантийная зависимость от поставщика",
          help: "Чем выше зависимость от одного поставщика/производителя, тем выше балл.",
        },
        {
          key: "paymentComplexity",
          label: "Потенциальная комплексность приёмки и оплаты",
          help: "1 — единоразовая оплата; 5 — комплексная оплата с казначейским сопровождением.",
        },
      ],
      indicators: [
        {
          key: "fastAcceptance",
          label: "Приёмка осуществляется менее чем за 5 рабочих дней",
        },
        {
          key: "fastPayment",
          label: "Оплата осуществляется менее чем за 7 рабочих дней",
        },
        {
          key: "endOfYear",
          label: "Приёмка и оплата планируются на конец финансового года",
        },
      ],
      stageMeasures: [
        "Усилить контроль процедуры приёмки и фиксации результатов.",
        "При необходимости привлечь эксперта или расширить приёмочную комиссию.",
        "Организовать отдельный мониторинг сроков оплаты и исполнения.",
      ],
    },
  },
  significance: [
    {
      key: "financial",
      label: "Финансовое воздействие (F)",
      help: "Оценивается по величине Н(М)ЦК или цены контракта с единственным поставщиком.",
    },
    {
      key: "social",
      label: "Социальная значимость (S)",
      help: "Оценивается экспертно по значимости предмета закупки и её последствиям для деятельности органа власти.",
    },
    {
      key: "legal",
      label: "Правовые последствия (L)",
      help: "Оценивается с опорой на возможные последствия по КоАП РФ.",
    },
  ],
};

// -----------------------------
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// -----------------------------

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function sumBinary(values) {
  return values.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

function getRiskMeta(score) {
  return STRATEGY_RULES.find((rule) => score >= rule.min && score <= rule.max) || STRATEGY_RULES[0];
}

function getFinancialScore(nmck) {
  const value = Number(nmck || 0);
  if (value <= 600000) return 1;
  if (value <= 3000000) return 2;
  if (value <= 50000000) return 3;
  if (value <= 100000000) return 4;
  return 5;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2);
}

function calculateStageRisk({ probabilityValues, significanceValues, manageability, indicators, corruptionFactor, useCorruption }) {
  const P = average(probabilityValues);
  const I = average(significanceValues);
  const M = Number(manageability || 1);
  const Z = sumBinary(indicators);

  const base = P * I;
  const adjusted = useCorruption ? (base * corruptionFactor) / M : base / M;
  const R = adjusted + Z;

  return { P, I, M, Z, R };
}

// -----------------------------
// 3. СТАРТОВЫЕ ДАННЫЕ
// -----------------------------

const initialState = {
  procurementInfo: {
    name: "",
    nmck: "",
    object: "",
  },
  significance: {
    financial: 1,
    social: 1,
    legal: 1,
  },
  corruption: {
    plan: 1.2,
    proc: 1.2,
  },
  manageability: {
    plan: 2,
    proc: 2,
    exec: 2,
  },
  probability: {
    plan: {
      novelty: 1,
      methodComplexity: 1,
      stagesDuration: 1,
      regulation: 1,
      planningUrgency: 1,
    },
    proc: {
      evaluationComplexity: 1,
      marketCompetition: 1,
      commissionExperience: 1,
      similarProcurementHistory: 1,
      documentsCheck: 1,
    },
    exec: {
      contractChanges: 1,
      acceptanceComplexity: 1,
      acceptanceCommissionExperience: 1,
      warrantyDependence: 1,
      paymentComplexity: 1,
    },
  },
  indicators: {
    plan: {
      oldCommercialOffers: false,
      recentLawChanges: false,
      newResponsibleOfficer: false,
    },
    proc: {
      minimumCommission: false,
      highSecurityRequirements: false,
      foreignBan1875: false,
    },
    exec: {
      fastAcceptance: false,
      fastPayment: false,
      endOfYear: false,
    },
  },
};

// -----------------------------
// 4. UI-КОМПОНЕНТЫ
// -----------------------------

function ScoreField({ label, help, value, onChange, options = SCORE_OPTIONS_1_5 }) {
  return (
    <div className="space-y-2 rounded-2xl border p-4">
      <div className="space-y-1">
        <div className="font-medium">{label}</div>
        {help ? <div className="text-sm text-muted-foreground">{help}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            variant={Number(value) === option ? "default" : "outline"}
            onClick={() => onChange(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

function BinaryField({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border p-4 gap-4">
      <div className="font-medium">{label}</div>
      <div className="flex gap-2">
        <Button type="button" variant={value ? "outline" : "default"} onClick={() => onChange(false)}>
          Нет
        </Button>
        <Button type="button" variant={value ? "default" : "outline"} onClick={() => onChange(true)}>
          Да
        </Button>
      </div>
    </div>
  );
}

function RiskBadge({ score }) {
  const meta = getRiskMeta(score);
  return <Badge className={meta.color}>{meta.level}</Badge>;
}

// -----------------------------
// 5. ОСНОВНОЙ КОМПОНЕНТ
// -----------------------------

export default function ProcurementRiskApp() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialState);

  const updateProcurementInfo = (key, value) => {
    setData((prev) => ({
      ...prev,
      procurementInfo: {
        ...prev.procurementInfo,
        [key]: value,
      },
    }));
  };

  const updateProbability = (stage, key, value) => {
    setData((prev) => ({
      ...prev,
      probability: {
        ...prev.probability,
        [stage]: {
          ...prev.probability[stage],
          [key]: value,
        },
      },
    }));
  };

  const updateIndicator = (stage, key, value) => {
    setData((prev) => ({
      ...prev,
      indicators: {
        ...prev.indicators,
        [stage]: {
          ...prev.indicators[stage],
          [key]: value,
        },
      },
    }));
  };

  const updateSignificance = (key, value) => {
    setData((prev) => ({
      ...prev,
      significance: {
        ...prev.significance,
        [key]: value,
      },
    }));
  };

  const updateManageability = (stage, value) => {
    setData((prev) => ({
      ...prev,
      manageability: {
        ...prev.manageability,
        [stage]: value,
      },
    }));
  };

  const updateCorruption = (stage, value) => {
    setData((prev) => ({
      ...prev,
      corruption: {
        ...prev.corruption,
        [stage]: value,
      },
    }));
  };

  // Автоматически подставляем финансовое воздействие из Н(М)ЦК.
  const autoFinancialScore = useMemo(() => getFinancialScore(data.procurementInfo.nmck), [data.procurementInfo.nmck]);

  const results = useMemo(() => {
    const significanceValues = [
      autoFinancialScore,
      Number(data.significance.social || 1),
      Number(data.significance.legal || 1),
    ];

    const plan = calculateStageRisk({
      probabilityValues: Object.values(data.probability.plan),
      significanceValues,
      manageability: data.manageability.plan,
      indicators: Object.values(data.indicators.plan),
      corruptionFactor: Number(data.corruption.plan || 1.2),
      useCorruption: true,
    });

    const proc = calculateStageRisk({
      probabilityValues: Object.values(data.probability.proc),
      significanceValues,
      manageability: data.manageability.proc,
      indicators: Object.values(data.indicators.proc),
      corruptionFactor: Number(data.corruption.proc || 1.2),
      useCorruption: true,
    });

    const exec = calculateStageRisk({
      probabilityValues: Object.values(data.probability.exec),
      significanceValues,
      manageability: data.manageability.exec,
      indicators: Object.values(data.indicators.exec),
      corruptionFactor: 1,
      useCorruption: false,
    });

    const totalRisk = Math.max(plan.R, proc.R, exec.R);
    const totalMeta = getRiskMeta(totalRisk);

    const mostDangerousStage = [
      { key: "plan", title: "Предпроцедурный этап", value: plan.R },
      { key: "proc", title: "Процедурный этап", value: proc.R },
      { key: "exec", title: "Постпроцедурный этап", value: exec.R },
    ].sort((a, b) => b.value - a.value)[0];

    return {
      significanceValues,
      plan,
      proc,
      exec,
      totalRisk,
      totalMeta,
      mostDangerousStage,
    };
  }, [data, autoFinancialScore]);

  const progress = ((step + 1) / STEP_TITLES.length) * 100;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <Card className="rounded-3xl shadow-sm">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">Калькулятор риска закупки</CardTitle>
                <CardDescription>
                  Веб-приложение для расчёта риска по трём этапам закупки и определения общего уровня риска.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-sm">Шаг {step + 1} из {STEP_TITLES.length}</Badge>
            </div>
            <Progress value={progress} className="mt-4" />
          </CardHeader>
        </Card>

        {step === 0 && (
          <Card className="rounded-3xl shadow-sm">
            <CardHeader>
              <CardTitle>Шаг 1. Паспорт закупки</CardTitle>
              <CardDescription>
                Здесь вводятся основные сведения. Финансовое воздействие рассчитывается автоматически из Н(М)ЦК.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                {CONFIG.procurementInfo.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">{field.label}</label>
                    <Input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={data.procurementInfo[field.key]}
                      onChange={(e) => updateProcurementInfo(field.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <ScoreField
                  label="Социальная значимость (S)"
                  help="Оценивается экспертно: чем значимее предмет закупки для функций органа власти, тем выше балл."
                  value={data.significance.social}
                  onChange={(value) => updateSignificance("social", value)}
                />
                <ScoreField
                  label="Правовые последствия (L)"
                  help="Оценивается по возможным последствиям нарушений, в том числе по КоАП РФ."
                  value={data.significance.legal}
                  onChange={(value) => updateSignificance("legal", value)}
                />
              </div>

              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertTitle>Автоматический расчёт F</AlertTitle>
                <AlertDescription>
                  По введённой Н(М)ЦК финансовое воздействие сейчас равно <b>{autoFinancialScore}</b>.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <StageScreen
            title={CONFIG.stages.plan.title}
            probabilityCriteria={CONFIG.stages.plan.probabilityCriteria}
            indicators={CONFIG.stages.plan.indicators}
            probabilityValues={data.probability.plan}
            indicatorValues={data.indicators.plan}
            manageabilityValue={data.manageability.plan}
            corruptionValue={data.corruption.plan}
            onProbabilityChange={(key, value) => updateProbability("plan", key, value)}
            onIndicatorChange={(key, value) => updateIndicator("plan", key, value)}
            onManageabilityChange={(value) => updateManageability("plan", value)}
            onCorruptionChange={(value) => updateCorruption("plan", value)}
            showCorruption
          />
        )}

        {step === 2 && (
          <StageScreen
            title={CONFIG.stages.proc.title}
            probabilityCriteria={CONFIG.stages.proc.probabilityCriteria}
            indicators={CONFIG.stages.proc.indicators}
            probabilityValues={data.probability.proc}
            indicatorValues={data.indicators.proc}
            manageabilityValue={data.manageability.proc}
            corruptionValue={data.corruption.proc}
            onProbabilityChange={(key, value) => updateProbability("proc", key, value)}
            onIndicatorChange={(key, value) => updateIndicator("proc", key, value)}
            onManageabilityChange={(value) => updateManageability("proc", value)}
            onCorruptionChange={(value) => updateCorruption("proc", value)}
            showCorruption
          />
        )}

        {step === 3 && (
          <StageScreen
            title={CONFIG.stages.exec.title}
            probabilityCriteria={CONFIG.stages.exec.probabilityCriteria}
            indicators={CONFIG.stages.exec.indicators}
            probabilityValues={data.probability.exec}
            indicatorValues={data.indicators.exec}
            manageabilityValue={data.manageability.exec}
            corruptionValue={1}
            onProbabilityChange={(key, value) => updateProbability("exec", key, value)}
            onIndicatorChange={(key, value) => updateIndicator("exec", key, value)}
            onManageabilityChange={(value) => updateManageability("exec", value)}
            onCorruptionChange={() => {}}
            showCorruption={false}
          />
        )}

        {step === 4 && (
          <ResultsScreen data={data} results={results} autoFinancialScore={autoFinancialScore} />
        )}

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((prev) => prev - 1)}>
            Назад
          </Button>

          <div className="text-sm text-muted-foreground text-center">
            Текущий раздел: <b>{STEP_TITLES[step]}</b>
          </div>

          <Button type="button" disabled={step === STEP_TITLES.length - 1} onClick={() => setStep((prev) => prev + 1)}>
            Далее
          </Button>
        </div>
      </div>
    </div>
  );
}

function StageScreen({
  title,
  probabilityCriteria,
  indicators,
  probabilityValues,
  indicatorValues,
  manageabilityValue,
  corruptionValue,
  onProbabilityChange,
  onIndicatorChange,
  onManageabilityChange,
  onCorruptionChange,
  showCorruption,
}) {
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Для каждого критерия выбери значение по шкале. Для индикаторов выбери «да» или «нет».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="text-lg font-semibold">1. Критерии вероятности</div>
          {probabilityCriteria.map((criterion) => (
            <ScoreField
              key={criterion.key}
              label={criterion.label}
              help={criterion.help}
              value={probabilityValues[criterion.key]}
              onChange={(value) => onProbabilityChange(criterion.key, value)}
            />
          ))}
        </div>

        <Separator />

        <div className="grid gap-4 md:grid-cols-2">
          <ScoreField
            label="Управляемость риска (M)"
            help="1 — риск практически не поддаётся контролю; 2 — контролируется частично; 3 — контролируется в высокой степени."
            value={manageabilityValue}
            onChange={onManageabilityChange}
            options={SCORE_OPTIONS_1_3}
          />

          {showCorruption ? (
            <div className="space-y-2 rounded-2xl border p-4">
              <div className="font-medium">Коррупционная уязвимость процедуры (Kc)</div>
              <div className="text-sm text-muted-foreground">
                Для предпроцедурного и процедурного этапов выбери тип процедуры.
              </div>
              <div className="space-y-2">
                {CORRUPTION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onCorruptionChange(option.value)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      Number(corruptionValue) === option.value ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="font-medium">{option.label}</div>
                    <div className="text-sm text-muted-foreground">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Kc не используется</AlertTitle>
              <AlertDescription>
                Для постпроцедурного этапа коэффициент коррупционной уязвимости не применяется.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="text-lg font-semibold">2. Бинарные индикаторы риска (ΣZ)</div>
          {indicators.map((indicator) => (
            <BinaryField
              key={indicator.key}
              label={indicator.label}
              value={indicatorValues[indicator.key]}
              onChange={(value) => onIndicatorChange(indicator.key, value)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultsScreen({ data, results, autoFinancialScore }) {
  const totalMeta = results.totalMeta;
  const stageMeta = {
    plan: getRiskMeta(results.plan.R),
    proc: getRiskMeta(results.proc.R),
    exec: getRiskMeta(results.exec.R),
  };

  const stageSpecificMeasures = CONFIG.stages[results.mostDangerousStage.key].stageMeasures;

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl shadow-sm">
        <CardHeader>
          <CardTitle>Результаты расчёта</CardTitle>
          <CardDescription>
            Ниже показаны риски по этапам и общий уровень риска закупки.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <ResultCard title="Предпроцедурный этап" score={results.plan.R} P={results.plan.P} I={results.plan.I} M={results.plan.M} Z={results.plan.Z} K={data.corruption.plan} meta={stageMeta.plan} />
            <ResultCard title="Процедурный этап" score={results.proc.R} P={results.proc.P} I={results.proc.I} M={results.proc.M} Z={results.proc.Z} K={data.corruption.proc} meta={stageMeta.proc} />
            <ResultCard title="Постпроцедурный этап" score={results.exec.R} P={results.exec.P} I={results.exec.I} M={results.exec.M} Z={results.exec.Z} meta={stageMeta.exec} />
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="rounded-3xl border-2 border-slate-900">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Общий риск закупки
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-4xl font-bold">{formatNumber(results.totalRisk)}</div>
                <RiskBadge score={results.totalRisk} />
                <div className="text-sm text-muted-foreground">
                  Общий риск определяется как максимум из трёх этапов: <b>max(R_plan, R_proc, R_exec)</b>.
                </div>
                <div>
                  Наиболее рискованный этап: <b>{results.mostDangerousStage.title}</b>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle>Стратегия реагирования</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge className={totalMeta.color}>{totalMeta.strategy}</Badge>
                <div className="text-sm text-muted-foreground">
                  Рекомендуемая стратегия определяется автоматически по итоговому уровню риска.
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl shadow-sm">
        <CardHeader>
          <CardTitle>Рекомендации по минимизации риска</CardTitle>
          <CardDescription>
            Сначала показаны общие меры по стратегии, затем — меры именно для наиболее рискованного этапа.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="mb-2 text-lg font-semibold">1. Общие меры</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {totalMeta.measures.map((measure, index) => (
                <li key={index} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{measure}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-2 text-lg font-semibold">2. Специальные меры для этапа: {results.mostDangerousStage.title}</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {stageSpecificMeasures.map((measure, index) => (
                <li key={index} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{measure}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl shadow-sm">
        <CardHeader>
          <CardTitle>Как работает расчёт</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div><b>F</b> = {autoFinancialScore}, <b>S</b> = {data.significance.social}, <b>L</b> = {data.significance.legal}</div>
          <div>Значимость для всех этапов считается как среднее: <b>I = (F + S + L) / 3</b>.</div>
          <div>Вероятность для каждого этапа считается как среднее по критериям этапа.</div>
          <div>Для первых двух этапов применяется коррупционная уязвимость <b>Kc</b>, для постпроцедурного — нет.</div>
          <div>Бинарные индикаторы <b>ΣZ</b> добавляются к результату каждого этапа.</div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultCard({ title, score, P, I, M, Z, K, meta }) {
  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-3xl font-bold">{formatNumber(score)}</div>
        <RiskBadge score={score} />
        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <div>P: <b>{formatNumber(P)}</b></div>
          <div>I: <b>{formatNumber(I)}</b></div>
          <div>M: <b>{formatNumber(M)}</b></div>
          <div>ΣZ: <b>{Z}</b></div>
          {K ? <div className="col-span-2">Kc: <b>{formatNumber(K)}</b></div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
