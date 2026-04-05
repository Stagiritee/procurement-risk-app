import { useMemo, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

type StageKey = "plan" | "proc" | "exec";

type RiskRule = {
  min: number;
  max: number;
  level: string;
  colorClass: string;
  strategy: string;
  measures: string[];
};

type ProbabilityCriterion = {
  key: string;
  label: string;
  scale: string[];
};

type Indicator = {
  key: string;
  label: string;
};

type StageConfig = {
  title: string;
  probabilityCriteria: ProbabilityCriterion[];
  indicators: Indicator[];
  stageMeasures: string[];
};

type LegalItem = {
  event: string;
  score: number;
};

type LegalStageConfig = {
  title: string;
  items: LegalItem[];
};

type AppState = {
  procurementInfo: {
    name: string;
    nmck: string;
    object: string;
  };
  significance: {
    social: number;
  };
  legalOverrides: Record<StageKey, string>;
  corruption: Record<"plan" | "proc", number>;
  manageability: Record<StageKey, number>;
  probability: Record<StageKey, Record<string, number>>;
  indicators: Record<StageKey, Record<string, boolean>>;
};

type StageResult = {
  P: number;
  I: number;
  M: number;
  Z: number;
  R: number;
  legalScore: number;
};

const STEP_TITLES = [
  "Паспорт закупки",
  "Предпроцедурный этап",
  "Процедурный этап",
  "Постпроцедурный этап",
  "Результаты",
];

const SCORE_OPTIONS_1_5 = [1, 2, 3, 4, 5];
const SCORE_OPTIONS_1_3 = [1, 2, 3];

const STRATEGY_RULES: RiskRule[] = [
  {
    min: 0,
    max: 4.99,
    level: "Низкий",
    colorClass: "risk-low",
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
    colorClass: "risk-medium",
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
    colorClass: "risk-high",
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
    colorClass: "risk-critical",
    strategy: "Избежание или пересмотр закупки",
    measures: [
      "Пересмотреть параметры закупки, сроки, способ закупки и структуру лота.",
      "Передать закупку на уровень усиленного согласования с руководством.",
      "До проведения закупки устранить ключевые факторы риска.",
    ],
  },
];

const CORRUPTION_OPTIONS = [
  { value: 1.1, label: "Малая закупка на ЕАТ", description: "α = 0,1 -> коэффициент 1,1" },
  { value: 1.2, label: "Конкурентная закупка", description: "α = 0,2 -> коэффициент 1,2" },
  { value: 1.3, label: "Единственный поставщик", description: "α = 0,3 -> коэффициент 1,3" },
];

const LEGAL_STAGE_CONFIG: Record<StageKey, LegalStageConfig> = {
  plan: {
    title: "Предпроцедурный этап",
    items: [
      { event: "Нарушение порядка формирования, утверждения, ведения планов-графиков закупок (ч. 1 ст. 7.30.1)", score: 2 },
      { event: "Нарушение при нормировании (ч. 3 ст. 7.30.1)", score: 3 },
      { event: "Необоснование или неверный расчёт начальной (максимальной) цены контракта (ч. 5 ст. 7.30.1)", score: 4 },
      { event: "Неверный выбор способа определения поставщика (ч. 4 ст. 7.30.1)", score: 4 },
      { event: "Нарушение порядка описания объекта закупки (ст. 7.30.4)", score: 4 },
      { event: "Нарушение порядка размещения извещения, документации, внесения изменений (ст. 7.30.2)", score: 2 },
    ],
  },
  proc: {
    title: "Процедурный этап",
    items: [
      { event: "Нарушение порядка рассмотрения, оценки заявок, подведения итогов (ст. 7.30.3)", score: 3 },
      { event: "Нарушение порядка заключения контракта, в том числе уклонение от заключения (ч. 1-3 ст. 7.32)", score: 4 },
    ],
  },
  exec: {
    title: "Постпроцедурный этап",
    items: [
      { event: "Незаконное изменение условий контракта, в том числе цены, сроков, объема (ч. 4 ст. 7.32)", score: 4 },
      { event: "Нарушение срока оплаты заказчиком поставленных товаров, выполненных работ, оказанных услуг (ч. 5 ст. 7.32)", score: 2 },
      { event: "Приёмка непоставленных товаров, невыполненных работ, неоказанных услуг (ч. 10 ст. 7.32)", score: 5 },
      { event: "Нарушение порядка осуществления приёмки (ч. 11 ст. 7.32)", score: 4 },
    ],
  },
};

const STAGES: Record<StageKey, StageConfig> = {
  plan: {
    title: "Предпроцедурный этап",
    probabilityCriteria: [
      { key: "novelty", label: "Новизна предмета закупки", scale: ["1 - 5 и более раз за 2 года", "2 - 3-4 раза за 2 года", "3 - 1-2 раза за 2 года", "4 - не закупалось, но есть аналоги", "5 - не закупалось и нет аналогов"] },
      { key: "methodComplexity", label: "Сложность способа закупки", scale: ["1 - закупка на ЕАТ", "2 - запрос котировок", "3 - аукцион, закупка у единственного поставщика", "4 - конкурс с 1 дополнительным критерием", "5 - конкурс с несколькими критериями"] },
      { key: "stagesDuration", label: "Этапность и длительность", scale: ["1 - этапы не предусмотрены, срок исполнения до 6 месяцев", "2 - этапы не предусмотрены, срок исполнения более 6 месяцев", "3 - предусмотрено 2 этапа в пределах 1 года", "4 - предусмотрено 2 и более этапа в пределах 2 лет", "5 - предусмотрено 2 и более этапа в пределах 3 лет"] },
      { key: "regulation", label: "Законодательное регулирование", scale: ["1 - не предусмотрены дополнительные требования", "2 - установлены требования в соответствии с п. 1 ч. 1 ст. 31 или ч. 2.1 ст. 31", "3 - установлены требования в соответствии с ч. 2 ст. 31", "4 - установлен национальный режим", "5 - установлено 2 и более требований"] },
      { key: "planningUrgency", label: "Срочность планирования", scale: ["1 - плановый режим", "2 - небольшая срочность (>1 месяца)", "3 - умеренная срочность (2-4 недели)", "4 - высокая срочность (1-2 недели)", "5 - экстренное планирование (<1 недели)"] },
    ],
    indicators: [
      { key: "oldCommercialOffers", label: "Коммерческие предложения для Н(М)ЦК старше 5 месяцев" },
      { key: "recentLawChanges", label: "За 4 месяца до закупки были существенные изменения законодательства" },
      { key: "newResponsibleOfficer", label: "Ответственное должностное лицо ранее не участвовало в закупках" },
    ],
    stageMeasures: ["Дополнительно проверить обоснование Н(М)ЦК.", "Провести повторную правовую экспертизу способа закупки.", "Проверить описание объекта закупки на предмет избыточных требований."],
  },
  proc: {
    title: "Процедурный этап",
    probabilityCriteria: [
      { key: "evaluationComplexity", label: "Сложность критериев оценки", scale: ["1 - только цена", "2 - цена и количественные критерии", "3 - цена и 1 качественный критерий", "4 - цена и 2 и более критерия", "5 - только неценовые критерии"] },
      { key: "marketCompetition", label: "Конкурентность рынка", scale: ["1 - много поставщиков, высокая конкуренция", "2 - несколько поставщиков", "3 - ограниченное число поставщиков", "4 - мало поставщиков, рынок низко конкурентный", "5 - монопольный рынок (единственный поставщик)"] },
      { key: "commissionExperience", label: "Опыт работы закупочной комиссии", scale: ["1 - все обучены, есть опыт", "2 - 2 и больше человек обучены, опыт есть", "3 - 1 человек обучен, опыт средний", "4 - обучение отсутствует, опыт низкий", "5 - состав комиссии новый, опыта нет"] },
      { key: "similarProcurementHistory", label: "Опыт проведения аналогичных закупок", scale: ["1 - нет опыта", "2 - имеется опыт получения запроса разъяснений положений извещения", "3 - имеется опыт получения 2 и более запроса разъяснений положений извещения", "4 - имеется опыт необоснованных жалоб в ФАС", "5 - имеется опыт обоснованных жалоб в ФАС"] },
      { key: "documentsCheck", label: "Проверка требуемых законодательством документов", scale: ["1 - не требуется дополнительных документов", "2 - установлены требования в соответствии с п. 1 ч. 1 ст. 31 или ч. 2.1 ст. 31", "3 - установлены требования в соответствии с ч. 2 ст. 31", "4 - установлен национальный режим", "5 - установлено 2 и более требований"] },
    ],
    indicators: [
      { key: "minimumCommission", label: "В состав комиссии входит только 3 человека" },
      { key: "highSecurityRequirements", label: "Требования к обеспечению выше обычно устанавливаемого уровня" },
      { key: "foreignBan1875", label: "Установлен запрет по Постановлению № 1875" },
    ],
    stageMeasures: ["Усилить правовую проверку извещения и критериев оценки.", "Проверить достаточность и компетенции состава комиссии.", "Провести внутреннюю проверку на предмет ограничения конкуренции."],
  },
  exec: {
    title: "Постпроцедурный этап",
    probabilityCriteria: [
      { key: "contractChanges", label: "Количество изменений контракта по предмету закупки или с данным победителем процедуры", scale: ["1 - изменений не было", "2 - 1 изменение", "3 - 2 изменения", "4 - 3 изменения", "5 - 4 и более изменений или расторжение контракта"] },
      { key: "acceptanceComplexity", label: "Сложность приёмки", scale: ["1 - обычная приёмка по акту", "2 - приёмка с комиссией", "3 - поэтапная приёмка с комиссией", "4 - приёмка особо сложных объектов закупки", "5 - приёмка с участием независимых экспертов"] },
      { key: "acceptanceCommissionExperience", label: "Опыт работы приёмочной комиссии", scale: ["1 - все обучены, есть опыт", "2 - 2 и больше человек обучены, опыт есть", "3 - 1 человек обучен, опыт средний", "4 - обучение отсутствует, опыт низкий", "5 - состав комиссии новый, опыта нет"] },
      { key: "warrantyDependence", label: "Гарантийная зависимость от поставщика", scale: ["1 - гарантия не требуется", "2 - гарантия до 2 лет, достаточно гарантии поставщика", "3 - гарантия более 2 лет", "4 - требуется гарантия производителя более 2 лет", "5 - поставщик является единственным производителем продукта"] },
      { key: "paymentComplexity", label: "Потенциальная комплексность приёмки", scale: ["1 - единоразовая оплата", "2 - поэтапная оплата", "3 - поэтапная оплата с авансированием", "4 - оплата с казначейским сопровождением", "5 - поэтапная оплата с казначейским сопровождением и авансированием"] },
    ],
    indicators: [
      { key: "fastAcceptance", label: "Приёмка осуществляется менее чем за 5 рабочих дней" },
      { key: "fastPayment", label: "Оплата осуществляется менее чем за 7 рабочих дней" },
      { key: "endOfYear", label: "Приёмка и оплата планируются на конец финансового года" },
    ],
    stageMeasures: ["Усилить контроль процедуры приёмки и фиксации результатов.", "При необходимости привлечь эксперта или расширить приёмочную комиссию.", "Организовать отдельный мониторинг сроков оплаты и исполнения."],
  },
};

const initialState: AppState = {
  procurementInfo: { name: "", nmck: "", object: "" },
  significance: { social: 1 },
  legalOverrides: { plan: "", proc: "", exec: "" },
  corruption: { plan: 1.2, proc: 1.2 },
  manageability: { plan: 2, proc: 2, exec: 2 },
  probability: {
    plan: { novelty: 1, methodComplexity: 1, stagesDuration: 1, regulation: 1, planningUrgency: 1 },
    proc: { evaluationComplexity: 1, marketCompetition: 1, commissionExperience: 1, similarProcurementHistory: 1, documentsCheck: 1 },
    exec: { contractChanges: 1, acceptanceComplexity: 1, acceptanceCommissionExperience: 1, warrantyDependence: 1, paymentComplexity: 1 },
  },
  indicators: {
    plan: { oldCommercialOffers: false, recentLawChanges: false, newResponsibleOfficer: false },
    proc: { minimumCommission: false, highSecurityRequirements: false, foreignBan1875: false },
    exec: { fastAcceptance: false, fastPayment: false, endOfYear: false },
  },
};

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumBinary(values: boolean[]) {
  return values.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

function getFinancialScore(nmck: string) {
  const value = Number(nmck || 0);
  if (value <= 600000) return 1;
  if (value <= 3000000) return 2;
  if (value <= 50000000) return 3;
  if (value <= 100000000) return 4;
  return 5;
}

function formatNumber(value: number) {
  return value.toFixed(2);
}

function getRiskMeta(score: number) {
  return STRATEGY_RULES.find((rule) => score >= rule.min && score <= rule.max) ?? STRATEGY_RULES[0];
}

function getDefaultLegalScore(stage: StageKey) {
  return average(LEGAL_STAGE_CONFIG[stage].items.map((item) => item.score));
}

function getLegalScore(stage: StageKey, override: string) {
  const normalized = override.replace(",", ".").trim();
  if (!normalized) return getDefaultLegalScore(stage);
  const value = Number(normalized);
  return Number.isFinite(value) ? value : getDefaultLegalScore(stage);
}

function calculateStageRisk(params: {
  probabilityValues: number[];
  significanceValues: number[];
  manageability: number;
  indicators: boolean[];
  corruptionFactor: number;
  useCorruption: boolean;
}) {
  const P = average(params.probabilityValues);
  const I = average(params.significanceValues);
  const M = Number(params.manageability || 1);
  const Z = sumBinary(params.indicators);
  const base = P * I;
  const adjusted = params.useCorruption ? (base * params.corruptionFactor) / M : base / M;
  return { P, I, M, Z, R: adjusted + Z };
}

function ButtonChoice(props: {
  active: boolean;
  children: string | number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`choice-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function ScoreField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  help?: string;
  scale?: string[];
  options?: number[];
}) {
  return (
    <section className="panel panel-tight">
      <div className="field-title">{props.label}</div>
      {props.help ? <div className="muted">{props.help}</div> : null}
      {props.scale?.length ? (
        <div className="scale-box">
          <div className="scale-title">Условия присвоения балла</div>
          {props.scale.map((item) => (
            <div key={item} className="scale-line">
              {item}
            </div>
          ))}
        </div>
      ) : null}
      <div className="choice-row">
        {(props.options ?? SCORE_OPTIONS_1_5).map((option) => (
          <ButtonChoice key={option} active={props.value === option} onClick={() => props.onChange(option)}>
            {option}
          </ButtonChoice>
        ))}
      </div>
    </section>
  );
}

function BinaryField(props: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <section className="binary-field">
      <div className="field-title">{props.label}</div>
      <div className="choice-row">
        <ButtonChoice active={!props.value} onClick={() => props.onChange(false)}>
          Нет
        </ButtonChoice>
        <ButtonChoice active={props.value} onClick={() => props.onChange(true)}>
          Да
        </ButtonChoice>
      </div>
    </section>
  );
}

function RiskBadge({ score }: { score: number }) {
  const meta = getRiskMeta(score);
  return <span className={`risk-badge ${meta.colorClass}`}>{meta.level}</span>;
}

function LegalScoreCard(props: {
  stageKey: StageKey;
  overrideValue: string;
  onChange: (value: string) => void;
}) {
  const config = LEGAL_STAGE_CONFIG[props.stageKey];
  const defaultScore = getDefaultLegalScore(props.stageKey);
  const currentScore = getLegalScore(props.stageKey, props.overrideValue);
  const overridden = props.overrideValue.trim().length > 0;

  return (
    <section className="panel">
      <h3>{config.title}</h3>
      <div className="score-hero compact-score">
        <div className="score-big">{formatNumber(defaultScore)}</div>
      </div>
      <label className="input-group">
        <span>Пользовательское значение правовых последствий</span>
        <input
          type="number"
          step="0.01"
          value={props.overrideValue}
          placeholder={`По умолчанию ${formatNumber(defaultScore)}`}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </label>
      <div className="muted">
        {overridden
          ? `Сейчас в расчёт пойдёт пользовательское значение ${formatNumber(currentScore)}.`
          : "Если поле оставить пустым, приложение использует фиксированное значение по таблице."}
      </div>
      <div className="panel panel-tight nested-panel">
        <div className="field-title">События и баллы</div>
        {config.items.map((item) => (
          <div key={item.event} className="legal-row">
            <span>{item.event}</span>
            <strong>{item.score}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function StageScreen(props: {
  title: string;
  probabilityCriteria: ProbabilityCriterion[];
  indicators: Indicator[];
  probabilityValues: Record<string, number>;
  indicatorValues: Record<string, boolean>;
  manageabilityValue: number;
  corruptionValue: number;
  onProbabilityChange: (key: string, value: number) => void;
  onIndicatorChange: (key: string, value: boolean) => void;
  onManageabilityChange: (value: number) => void;
  onCorruptionChange: (value: number) => void;
  showCorruption: boolean;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>{props.title}</h2>
        <p>Для каждого критерия выберите значение по шкале. Для индикаторов выберите "да" или "нет".</p>
      </div>
      <div className="card-content section-gap">
        <div className="section-gap">
          <h3>1. Критерии вероятности</h3>
          {props.probabilityCriteria.map((criterion) => (
            <ScoreField
              key={criterion.key}
              label={criterion.label}
              scale={criterion.scale}
              value={props.probabilityValues[criterion.key]}
              onChange={(value) => props.onProbabilityChange(criterion.key, value)}
            />
          ))}
        </div>

        <div className="section-gap">
          <h3>2. Управляемость риска</h3>
          <ScoreField
            label="Коэффициент управляемости"
            help="1 - риск практически не поддаётся контролю; 2 - контролируется частично; 3 - контролируется в высокой степени."
            value={props.manageabilityValue}
            onChange={props.onManageabilityChange}
            options={SCORE_OPTIONS_1_3}
          />
        </div>

        <div className="section-gap">
          <h3>3. Коррупционная уязвимость процедуры</h3>
          {props.showCorruption ? (
            <section className="panel">
              <div className="muted">Для предпроцедурного и процедурного этапов выберите тип процедуры.</div>
              <div className="stack">
                {CORRUPTION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`option-card ${props.corruptionValue === option.value ? "selected" : ""}`}
                    onClick={() => props.onCorruptionChange(option.value)}
                  >
                    <strong>{option.label}</strong>
                    <span className="muted">{option.description}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="alert-box">
              <strong>Коррупционная уязвимость не используется</strong>
              <p>Для постпроцедурного этапа коэффициент коррупционной уязвимости не применяется.</p>
            </section>
          )}
        </div>

        <div className="section-gap">
          <h3>4. Бинарные индикаторы риска</h3>
          {props.indicators.map((indicator) => (
            <BinaryField
              key={indicator.key}
              label={indicator.label}
              value={props.indicatorValues[indicator.key]}
              onChange={(value) => props.onIndicatorChange(indicator.key, value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ResultCard(props: {
  title: string;
  score: number;
  P: number;
  I: number;
  M: number;
  Z: number;
  legalScore: number;
  K?: number;
}) {
  return (
    <section className="panel">
      <h3>{props.title}</h3>
      <div className="score-big">{formatNumber(props.score)}</div>
      <RiskBadge score={props.score} />
      <div className="metrics-grid">
        <div>Вероятность: <strong>{formatNumber(props.P)}</strong></div>
        <div>Значимость: <strong>{formatNumber(props.I)}</strong></div>
        <div>Управляемость: <strong>{formatNumber(props.M)}</strong></div>
        <div>Бинарные индикаторы: <strong>{props.Z}</strong></div>
        <div className="metrics-wide">Правовые последствия: <strong>{formatNumber(props.legalScore)}</strong></div>
        {props.K ? <div className="metrics-wide">Коррупционная уязвимость: <strong>{formatNumber(props.K)}</strong></div> : null}
      </div>
    </section>
  );
}

function RiskScale({ score }: { score: number }) {
  const maxValue = 25;
  const marker = Math.min((score / maxValue) * 100, 100);

  return (
    <div className="scale-wrap">
      <div className="scale-track-wrap">
        <div className="scale-track" />
        <div className="scale-marker" style={{ left: `${marker}%` }}>
          <div className="scale-label">{formatNumber(score)}</div>
          <div className="scale-stick" />
        </div>
      </div>
      <div className="scale-points">
        <span>0</span>
        <span>{maxValue}</span>
      </div>
      <div className="scale-zone-labels bottom">
        <span className="zone-low">Низкий</span>
        <span className="zone-medium">Средний</span>
        <span className="zone-high">Высокий</span>
      </div>
    </div>
  );
}

function ResultsScreen(props: {
  data: AppState;
  autoFinancialScore: number;
  generatedAt: string;
  results: {
    plan: StageResult;
    proc: StageResult;
    exec: StageResult;
    totalRisk: number;
    totalMeta: RiskRule;
    mostDangerousStage: { key: StageKey; title: string; value: number };
  };
  onExportPdf: () => void;
}) {
  const stageSpecificMeasures = STAGES[props.results.mostDangerousStage.key].stageMeasures;

  return (
    <div className="section-gap">
      <div className="toolbar no-print">
        <button type="button" className="primary-button" onClick={props.onExportPdf}>
          Выгрузить PDF-отчёт
        </button>
      </div>

      <div id="report-dashboard" className="section-gap">
        <section className="card report-head print-only">
          <div className="report-grid">
            <div><strong>Наименование закупки:</strong> {props.data.procurementInfo.name || "Не указано"}</div>
            <div><strong>Дата и время отчёта:</strong> {props.generatedAt}</div>
            <div><strong>Предмет закупки:</strong> {props.data.procurementInfo.object || "Не указано"}</div>
            <div><strong>Н(М)ЦК:</strong> {props.data.procurementInfo.nmck || "Не указано"}</div>
          </div>
        </section>

        <section className="card print-card">
          <div className="card-header">
            <h2>Результаты расчёта</h2>
            <p>Ниже показаны риски по этапам и общий уровень риска закупки.</p>
          </div>
          <div className="card-content section-gap">
            <div className="three-grid">
              <ResultCard title="Предпроцедурный этап" score={props.results.plan.R} P={props.results.plan.P} I={props.results.plan.I} M={props.results.plan.M} Z={props.results.plan.Z} K={props.data.corruption.plan} legalScore={props.results.plan.legalScore} />
              <ResultCard title="Процедурный этап" score={props.results.proc.R} P={props.results.proc.P} I={props.results.proc.I} M={props.results.proc.M} Z={props.results.proc.Z} K={props.data.corruption.proc} legalScore={props.results.proc.legalScore} />
              <ResultCard title="Постпроцедурный этап" score={props.results.exec.R} P={props.results.exec.P} I={props.results.exec.I} M={props.results.exec.M} Z={props.results.exec.Z} legalScore={props.results.exec.legalScore} />
            </div>

            <div className="responsive-two">
              <section className="panel total-risk-panel">
                <h3>Общий риск закупки</h3>
                <div className="score-xl">{formatNumber(props.results.totalRisk)}</div>
                <RiskBadge score={props.results.totalRisk} />
                <div>Наиболее рискованный этап: <strong>{props.results.mostDangerousStage.title}</strong></div>
                <RiskScale score={props.results.totalRisk} />
              </section>

              <section className="strategy-panel">
                <div className="strategy-eyebrow">Итоговая стратегия</div>
                <div className="strategy-title">{props.results.totalMeta.strategy}</div>
                <div className="strategy-level">Уровень риска: {props.results.totalMeta.level}</div>
                <p>
                  Рекомендуемая стратегия определяется автоматически по итоговому уровню риска и помогает понять,
                  насколько глубоко нужно вмешиваться в процесс закупки уже сейчас.
                </p>
              </section>
            </div>
          </div>
        </section>

        <section className="card print-card recommendations-card">
          <div className="card-header">
            <h2>Рекомендации по минимизации риска</h2>
            <p>Сначала показаны общие меры по стратегии, затем меры для наиболее рискованного этапа.</p>
          </div>
          <div className="card-content section-gap print-recommendations-grid">
            <div>
              <h3>1. Общие меры</h3>
              <ul className="list">
                {props.results.totalMeta.measures.map((measure) => (
                  <li key={measure}>{measure}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>2. Специальные меры для этапа: {props.results.mostDangerousStage.title}</h3>
              <ul className="list">
                {stageSpecificMeasures.map((measure) => (
                  <li key={measure}>{measure}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="card no-print pdf-export-keep">
          <div className="card-header">
            <h2>Как работает расчёт</h2>
          </div>
          <div className="card-content">
            <details className="formula-box">
              <summary>Показать формулы и порядок расчёта</summary>
              <div className="formula-content">
                <div className="panel panel-tight nested-panel">
                  <div className="formula-stage-summary">
                    <div className="formula-stage-title">Предпроцедурный этап</div>
                    <div className="formula-stage-values">
                      <span>P = {formatNumber(props.results.plan.P)}</span>
                      <span>I = {formatNumber(props.results.plan.I)}</span>
                      <span>M = {formatNumber(props.results.plan.M)}</span>
                      <span>Kc = {formatNumber(props.data.corruption.plan)}</span>
                      <span>ΣZ = {props.results.plan.Z}</span>
                      <span>R = {formatNumber(props.results.plan.R)}</span>
                    </div>
                  </div>
                  <div className="formula-stage-summary">
                    <div className="formula-stage-title">Процедурный этап</div>
                    <div className="formula-stage-values">
                      <span>P = {formatNumber(props.results.proc.P)}</span>
                      <span>I = {formatNumber(props.results.proc.I)}</span>
                      <span>M = {formatNumber(props.results.proc.M)}</span>
                      <span>Kc = {formatNumber(props.data.corruption.proc)}</span>
                      <span>ΣZ = {props.results.proc.Z}</span>
                      <span>R = {formatNumber(props.results.proc.R)}</span>
                    </div>
                  </div>
                  <div className="formula-stage-summary">
                    <div className="formula-stage-title">Постпроцедурный этап</div>
                    <div className="formula-stage-values">
                      <span>P = {formatNumber(props.results.exec.P)}</span>
                      <span>I = {formatNumber(props.results.exec.I)}</span>
                      <span>M = {formatNumber(props.results.exec.M)}</span>
                      <span>ΣZ = {props.results.exec.Z}</span>
                      <span>R = {formatNumber(props.results.exec.R)}</span>
                    </div>
                  </div>
                </div>

                <div className="formula-pretty">
                  <div className="formula-item">
                    <div className="formula-line">
                      R<sub>plan</sub> = <span className="fraction"><span className="top">(P<sub>plan</sub> × I<sub>plan</sub>) × K<sub>c,plan</sub></span><span className="bottom">M<sub>plan</sub></span></span> + ΣZ<sub>plan</sub>
                    </div>
                    <div className="formula-note">Для предпроцедурного этапа учитываются вероятность, значимость, коррупционная уязвимость, управляемость и бинарные индикаторы.</div>
                  </div>
                  <div className="formula-item">
                    <div className="formula-line">
                      R<sub>proc</sub> = <span className="fraction"><span className="top">(P<sub>proc</sub> × I<sub>proc</sub>) × K<sub>c,proc</sub></span><span className="bottom">M<sub>proc</sub></span></span> + ΣZ<sub>proc</sub>
                    </div>
                    <div className="formula-note">Для процедурного этапа используется та же логика расчёта, что и для предпроцедурного.</div>
                  </div>
                  <div className="formula-item">
                    <div className="formula-line">
                      R<sub>exec</sub> = <span className="fraction"><span className="top">P<sub>exec</sub> × I<sub>exec</sub></span><span className="bottom">M<sub>exec</sub></span></span> + ΣZ<sub>exec</sub>
                    </div>
                    <div className="formula-note">Для постпроцедурного этапа коррупционная уязвимость не применяется.</div>
                  </div>
                  <div className="formula-item">
                    <div className="formula-line">
                      I = <span className="fraction"><span className="top">F + S + L</span><span className="bottom">3</span></span>
                    </div>
                    <div className="formula-note">где F - финансовое воздействие, S - социальная значимость, L - правовые последствия по соответствующему этапу.</div>
                  </div>
                  <div className="formula-item">
                    <div className="formula-line">
                      P = <span className="fraction"><span className="top">p<sub>1</sub> + p<sub>2</sub> + ... + p<sub>n</sub></span><span className="bottom">n</span></span>
                    </div>
                    <div className="formula-note">где p<sub>i</sub> - балл отдельного рискового события, n - количество критериев вероятности на этапе.</div>
                  </div>
                  <div className="formula-item">
                    <div className="formula-line">
                      K<sub>c</sub> = 1 + α
                    </div>
                    <div className="formula-note">где α зависит от типа процедуры: 0,1 для малой закупки на ЕАТ, 0,2 для конкурентной закупки, 0,3 для закупки у единственного поставщика.</div>
                  </div>
                  <div className="formula-item">
                    <div className="formula-line">
                      R<sub>total</sub> = max(R<sub>plan</sub>, R<sub>proc</sub>, R<sub>exec</sub>)
                    </div>
                    <div className="formula-note">Итоговый уровень риска определяется как максимальное значение из трёх уровней риска по этапам.</div>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<AppState>(initialState);
  const [generatedAt] = useState(() => new Date().toLocaleString("ru-RU"));

  const autoFinancialScore = useMemo(() => getFinancialScore(data.procurementInfo.nmck), [data.procurementInfo.nmck]);

  const results = useMemo(() => {
    const legalScores = {
      plan: getLegalScore("plan", data.legalOverrides.plan),
      proc: getLegalScore("proc", data.legalOverrides.proc),
      exec: getLegalScore("exec", data.legalOverrides.exec),
    };
    const social = Number(data.significance.social || 1);

    const planBase = calculateStageRisk({
      probabilityValues: Object.values(data.probability.plan),
      significanceValues: [autoFinancialScore, social, legalScores.plan],
      manageability: data.manageability.plan,
      indicators: Object.values(data.indicators.plan),
      corruptionFactor: data.corruption.plan,
      useCorruption: true,
    });

    const procBase = calculateStageRisk({
      probabilityValues: Object.values(data.probability.proc),
      significanceValues: [autoFinancialScore, social, legalScores.proc],
      manageability: data.manageability.proc,
      indicators: Object.values(data.indicators.proc),
      corruptionFactor: data.corruption.proc,
      useCorruption: true,
    });

    const execBase = calculateStageRisk({
      probabilityValues: Object.values(data.probability.exec),
      significanceValues: [autoFinancialScore, social, legalScores.exec],
      manageability: data.manageability.exec,
      indicators: Object.values(data.indicators.exec),
      corruptionFactor: 1,
      useCorruption: false,
    });

    const plan: StageResult = { ...planBase, legalScore: legalScores.plan };
    const proc: StageResult = { ...procBase, legalScore: legalScores.proc };
    const exec: StageResult = { ...execBase, legalScore: legalScores.exec };
    const totalRisk = Math.max(plan.R, proc.R, exec.R);
    const totalMeta = getRiskMeta(totalRisk);
    const mostDangerousStage = [
      { key: "plan" as const, title: STAGES.plan.title, value: plan.R },
      { key: "proc" as const, title: STAGES.proc.title, value: proc.R },
      { key: "exec" as const, title: STAGES.exec.title, value: exec.R },
    ].sort((left, right) => right.value - left.value)[0];

    return { plan, proc, exec, totalRisk, totalMeta, mostDangerousStage };
  }, [autoFinancialScore, data]);

  const progress = ((step + 1) / STEP_TITLES.length) * 100;

  const updateProcurementInfo = (key: keyof AppState["procurementInfo"], value: string) => {
    setData((prev) => ({ ...prev, procurementInfo: { ...prev.procurementInfo, [key]: value } }));
  };

  const updateProbability = (stage: StageKey, key: string, value: number) => {
    setData((prev) => ({
      ...prev,
      probability: {
        ...prev.probability,
        [stage]: { ...prev.probability[stage], [key]: value },
      },
    }));
  };

  const updateIndicator = (stage: StageKey, key: string, value: boolean) => {
    setData((prev) => ({
      ...prev,
      indicators: {
        ...prev.indicators,
        [stage]: { ...prev.indicators[stage], [key]: value },
      },
    }));
  };

  const updateManageability = (stage: StageKey, value: number) => {
    setData((prev) => ({
      ...prev,
      manageability: { ...prev.manageability, [stage]: value },
    }));
  };

  const updateCorruption = (stage: "plan" | "proc", value: number) => {
    setData((prev) => ({
      ...prev,
      corruption: { ...prev.corruption, [stage]: value },
    }));
  };

  const exportPdfReport = async () => {
    const report = document.getElementById("report-dashboard");
    if (!report) return;
    const exportRoot = document.createElement("div");
    exportRoot.style.position = "fixed";
    exportRoot.style.left = "-20000px";
    exportRoot.style.top = "0";
    exportRoot.style.width = "1122px";
    exportRoot.style.padding = "24px";
    exportRoot.style.background = "#ffffff";
    exportRoot.style.zIndex = "-1";

    const clone = report.cloneNode(true) as HTMLElement;
    clone.id = "report-dashboard-export";
    clone.querySelectorAll(".no-print").forEach((element) => {
      if (!(element as HTMLElement).classList.contains("pdf-export-keep")) {
        element.remove();
      }
    });
    clone.querySelectorAll(".print-only").forEach((element) => {
      const node = element as HTMLElement;
      node.style.display = "block";
    });

    exportRoot.appendChild(clone);
    document.body.appendChild(exportRoot);

    try {
      const canvas = await html2canvas(exportRoot, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2;
      const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
      const renderWidth = canvas.width * scale;
      const renderHeight = canvas.height * scale;
      const x = (pageWidth - renderWidth) / 2;
      const y = margin;

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, renderWidth, renderHeight);
      pdf.save("Отчёт_по_риску_закупки.pdf");
    } finally {
      document.body.removeChild(exportRoot);
    }
  };

  return (
    <div className="app-shell">
      <main className="container">
        <section className="card hero-card">
          <div className="hero-top">
            <div>
              <h1>Калькулятор риска закупки</h1>
              <p>Веб-приложение для расчёта риска по трём этапам закупки и определения общего уровня риска.</p>
            </div>
            <span className="step-chip">Шаг {step + 1} из {STEP_TITLES.length}</span>
          </div>
          <div className="step-progress-grid" aria-label="Прогресс по этапам">
            {STEP_TITLES.map((title, index) => (
              <div
                key={title}
                className={`step-progress-segment ${index <= step ? "active" : ""}`}
                title={title}
              />
            ))}
          </div>
        </section>

        {step === 0 ? (
          <section className="card">
            <div className="card-header">
              <h2>Шаг 1. Паспорт закупки</h2>
              <p>Здесь вводятся основные сведения. Финансовое воздействие рассчитывается автоматически из Н(М)ЦК.</p>
            </div>
            <div className="card-content section-gap">
              <div className="responsive-two">
                <label className="input-group">
                  <span>Наименование закупки</span>
                  <input placeholder="Например: закупка серверного оборудования" value={data.procurementInfo.name} onChange={(event) => updateProcurementInfo("name", event.target.value)} />
                </label>
                <label className="input-group">
                  <span>Н(М)ЦК, руб.</span>
                  <input type="number" placeholder="Например: 12500000" value={data.procurementInfo.nmck} onChange={(event) => updateProcurementInfo("nmck", event.target.value)} />
                </label>
                <label className="input-group span-two">
                  <span>Предмет закупки</span>
                  <input placeholder="Например: поставка медицинского оборудования" value={data.procurementInfo.object} onChange={(event) => updateProcurementInfo("object", event.target.value)} />
                </label>
              </div>

              <ScoreField
                label="Социальная значимость"
                help="Оценивается экспертно: чем значимее предмет закупки для функций органа власти, тем выше балл."
                value={data.significance.social}
                onChange={(value) => setData((prev) => ({ ...prev, significance: { social: value } }))}
              />

              <section className="alert-box">
                <strong>Автоматический расчёт финансового воздействия</strong>
                <p>По введённой Н(М)ЦК финансовое воздействие сейчас равно <strong>{autoFinancialScore}</strong>.</p>
              </section>

              <div className="section-gap">
                <div>
                  <h3>Правовые последствия по этапам</h3>
                  <p className="muted">
                    По умолчанию приложение использует фиксированные средние значения по вашей таблице КоАП.
                    При необходимости для любого этапа можно вручную указать иное значение.
                  </p>
                </div>
                <div className="three-grid">
                  <LegalScoreCard stageKey="plan" overrideValue={data.legalOverrides.plan} onChange={(value) => setData((prev) => ({ ...prev, legalOverrides: { ...prev.legalOverrides, plan: value } }))} />
                  <LegalScoreCard stageKey="proc" overrideValue={data.legalOverrides.proc} onChange={(value) => setData((prev) => ({ ...prev, legalOverrides: { ...prev.legalOverrides, proc: value } }))} />
                  <LegalScoreCard stageKey="exec" overrideValue={data.legalOverrides.exec} onChange={(value) => setData((prev) => ({ ...prev, legalOverrides: { ...prev.legalOverrides, exec: value } }))} />
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {step === 1 ? <StageScreen title={STAGES.plan.title} probabilityCriteria={STAGES.plan.probabilityCriteria} indicators={STAGES.plan.indicators} probabilityValues={data.probability.plan} indicatorValues={data.indicators.plan} manageabilityValue={data.manageability.plan} corruptionValue={data.corruption.plan} onProbabilityChange={(key, value) => updateProbability("plan", key, value)} onIndicatorChange={(key, value) => updateIndicator("plan", key, value)} onManageabilityChange={(value) => updateManageability("plan", value)} onCorruptionChange={(value) => updateCorruption("plan", value)} showCorruption /> : null}
        {step === 2 ? <StageScreen title={STAGES.proc.title} probabilityCriteria={STAGES.proc.probabilityCriteria} indicators={STAGES.proc.indicators} probabilityValues={data.probability.proc} indicatorValues={data.indicators.proc} manageabilityValue={data.manageability.proc} corruptionValue={data.corruption.proc} onProbabilityChange={(key, value) => updateProbability("proc", key, value)} onIndicatorChange={(key, value) => updateIndicator("proc", key, value)} onManageabilityChange={(value) => updateManageability("proc", value)} onCorruptionChange={(value) => updateCorruption("proc", value)} showCorruption /> : null}
        {step === 3 ? <StageScreen title={STAGES.exec.title} probabilityCriteria={STAGES.exec.probabilityCriteria} indicators={STAGES.exec.indicators} probabilityValues={data.probability.exec} indicatorValues={data.indicators.exec} manageabilityValue={data.manageability.exec} corruptionValue={1} onProbabilityChange={(key, value) => updateProbability("exec", key, value)} onIndicatorChange={(key, value) => updateIndicator("exec", key, value)} onManageabilityChange={(value) => updateManageability("exec", value)} onCorruptionChange={() => undefined} showCorruption={false} /> : null}
        {step === 4 ? <ResultsScreen data={data} autoFinancialScore={autoFinancialScore} generatedAt={generatedAt} results={results} onExportPdf={exportPdfReport} /> : null}

        <div className="footer-nav no-print">
          <button type="button" className="secondary-button" disabled={step === 0} onClick={() => setStep((prev) => prev - 1)}>
            Назад
          </button>
          <div className="muted center-text">Текущий раздел: <strong>{STEP_TITLES[step]}</strong></div>
          <button type="button" className="primary-button" disabled={step === STEP_TITLES.length - 1} onClick={() => setStep((prev) => prev + 1)}>
            Далее
          </button>
        </div>
      </main>
    </div>
  );
}
