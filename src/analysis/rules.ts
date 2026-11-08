// 7 項目のルール評価。事実（観察）と提案（推測）を分けて記録する。
// 判定できない項目は「未確認」。問題なしと推定しない。効果の保証表現は使わない。
import type { PageFacts } from './extract.js';
import type { Capture } from './browser.js';

export const CATEGORIES: Record<number, string> = {
  1: 'スマートフォン表示',
  2: 'ファーストビューの訴求',
  3: '問い合わせ・予約への導線',
  4: 'サービス説明のわかりやすさ',
  5: '実績・事例・信頼情報',
  6: 'ページ構造・表示速度',
  7: 'デザイン上の改善余地',
};

export interface Finding {
  category: number;
  status: 'issue' | 'good' | 'unverified';
  fact: string;
  issuePoints: string[];
  suggestion: string;
  suggestionSource: 'rule' | 'template' | 'ai';
  evidenceUrl: string;
  screenshotKind: 'pc' | 'sp' | null;
  policy: string;
}

export interface RuleInput {
  top: PageFacts | null;
  pages: PageFacts[];
  pc: Capture | null;
  sp: Capture | null;
  fetchError?: string;
  now?: Date;
}

export function evaluate(input: RuleInput): Finding[] {
  const { top, pages, pc, sp } = input;
  const year = (input.now ?? new Date()).getFullYear();
  if (!top) {
    return Object.keys(CATEGORIES).map((k) => ({
      category: Number(k),
      status: 'unverified' as const,
      fact: `サイトを取得できなかったため確認していません（${input.fetchError ?? '理由不明'}）`,
      issuePoints: [],
      suggestion: '',
      suggestionSource: 'rule' as const,
      evidenceUrl: '',
      screenshotKind: null,
      policy: '取得可能になった後に再分析する',
    }));
  }
  const u = top.url;
  const f: Finding[] = [];

  // 1. スマートフォン表示
  {
    const facts: string[] = [];
    const points: string[] = [];
    let issue = false;
    const flag = (x: string) => (facts.push(x), points.push(x), (issue = true));
    if (!top.hasViewport) {
      flag('viewport メタタグがありません（スマートフォンで縮小表示される構造）');
    } else facts.push(`viewport 指定あり（${top.viewportContent}）`);
    if (sp) {
      if (sp.metrics.horizontalOverflow) {
        flag(`幅390pxの表示で横幅が ${sp.metrics.scrollWidth}px となり横スクロールが発生`);
      } else facts.push('幅390pxの表示で横スクロールは発生していません');
      if (sp.metrics.minFontPx !== null && sp.metrics.minFontPx < 12) {
        flag(`最小文字サイズ ${sp.metrics.minFontPx}px の要素あり`);
      }
    } else facts.push('スマートフォン幅の表示計測は未実施（ブラウザ未接続）');
    f.push({
      category: 1,
      status: sp || !top.hasViewport ? (issue ? 'issue' : 'good') : 'unverified',
      fact: facts.join('。'),
      issuePoints: points,
      suggestion: issue ? 'スマートフォン幅を基準にしたレスポンシブ構成にし、文字サイズ16px前後・タップしやすいボタン配置にする' : '',
      suggestionSource: 'rule',
      evidenceUrl: u,
      screenshotKind: 'sp',
      policy: 'スマートフォンでの表示を基準にしたレイアウトにしています',
    });
  }

  // 2. ファーストビュー
  {
    const facts: string[] = [];
    const points: string[] = [];
    let issue = false;
    const flag = (x: string) => (facts.push(x), points.push(x), (issue = true));
    if (!top.h1.length) {
      flag('h1 見出しがありません');
    } else facts.push(`h1:「${top.h1[0].slice(0, 40)}」`);
    if (top.h1.some((h) => /^(ようこそ|welcome|ホーム|トップ)/i.test(h))) {
      flag('h1 が挨拶・汎用語で、提供価値や対象地域が見出しに含まれていません');
    }
    facts.push(`タイトル:「${top.title.slice(0, 50)}」`);
    if (pc) facts.push(`PC幅の最初の画面に表示されたテキスト:「${pc.metrics.firstViewText.slice(0, 80)}」`);
    f.push({
      category: 2,
      status: issue ? 'issue' : pc ? 'good' : 'unverified',
      fact: facts.join('。'),
      issuePoints: points,
      suggestion: issue ? '最初の画面で「誰に・何を・どの地域で」が伝わる見出しと、主要な行動ボタンを配置する' : '',
      suggestionSource: 'rule',
      evidenceUrl: u,
      screenshotKind: 'pc',
      policy: '最初の画面に事業内容・地域・問い合わせボタンをまとめています',
    });
  }

  // 3. 問い合わせ・予約導線
  {
    const facts: string[] = [];
    const points: string[] = [];
    let issue = false;
    const flag = (x: string) => (facts.push(x), points.push(x), (issue = true));
    const anyForm = pages.some((p) => p.hasForm);
    if (!top.contactLinks.length) {
      flag('トップページに問い合わせ・予約ページへのリンクが見つかりません');
    } else facts.push(`問い合わせ系リンク: ${top.contactLinks.slice(0, 3).map((l) => `「${l.text || l.href}」`).join('、')}`);
    if (!top.telLinks.length && /\d{2,4}-\d{2,4}-\d{3,4}/.test(top.text)) {
      flag('電話番号が記載されていますが、タップで発信できるリンクになっていません');
    }
    if (!anyForm) facts.push('確認したページ内に問い合わせフォームはありません');
    if (pc) {
      if (!pc.metrics.ctaInFirstView) {
        flag('PC幅の最初の画面に問い合わせ・予約ボタンが表示されていません');
      }
    }
    f.push({
      category: 3,
      status: issue ? 'issue' : pc ? 'good' : 'unverified',
      fact: facts.join('。'),
      issuePoints: points,
      suggestion: issue ? 'ヘッダーと各セクション末尾に問い合わせ導線を置き、スマートフォンでは電話・問い合わせボタンを固定表示する' : '',
      suggestionSource: 'rule',
      evidenceUrl: u,
      screenshotKind: 'pc',
      policy: '問い合わせボタンを固定表示し、各所から問い合わせページへ移動できるようにしています',
    });
  }

  // 4. サービス説明
  {
    const facts: string[] = [];
    const points: string[] = [];
    let issue = false;
    const flag = (x: string) => (facts.push(x), points.push(x), (issue = true));
    const svcHeadings = pages.flatMap((p) => p.h2).filter((h) => /(サービス|事業|業務|診療|メニュー|料金)/.test(h));
    const hasSvcPage = pages.some((p) => p !== top && /(service|business|menu|業務|事業)/i.test(p.url + p.title));
    if (svcHeadings.length) facts.push(`サービス関連見出し: ${svcHeadings.slice(0, 3).map((h) => `「${h}」`).join('、')}`);
    else {
      flag('サービス内容を示す見出しが見つかりません');
    }
    if (hasSvcPage) facts.push('サービス説明ページあり');
    const longPara = top.text.split(/。/).some((s) => s.length > 120);
    if (longPara) {
      flag('120文字を超える長い一文があり、要点が箇条書き等で整理されていません');
    }
    f.push({
      category: 4,
      status: issue ? 'issue' : 'good',
      fact: facts.join('。'),
      issuePoints: points,
      suggestion: issue ? 'サービスごとに見出し・短い説明・対象のお客様を並べ、詳細ページへ誘導する' : '',
      suggestionSource: 'rule',
      evidenceUrl: u,
      screenshotKind: 'pc',
      policy: 'サービスごとに見出しと短い説明を並べたカード形式にしています',
    });
  }

  // 5. 実績・信頼情報
  {
    const kws = [...new Set(pages.flatMap((p) => p.trustKeywords))];
    const placeholder = pages.some((p) => /準備中|coming soon/i.test(p.text) && /(実績|事例|施工)/.test(p.title + p.h2.join('')));
    const facts: string[] = [];
    const points: string[] = [];
    let issue = false;
    const flag = (x: string) => (facts.push(x), points.push(x), (issue = true));
    if (kws.length) facts.push(`信頼情報に関する語: ${kws.slice(0, 6).join('・')}`);
    if (!kws.some((k) => /(実績|事例|施工例|施工事例|お客様の声|導入事例)/.test(k))) {
      flag('実績・事例の掲載を確認できません');
    }
    if (placeholder) {
      flag('実績・事例ページが「準備中」のままです');
    }
    f.push({
      category: 5,
      status: issue ? 'issue' : 'good',
      fact: facts.join('。') || '信頼情報の記載を確認できません',
      issuePoints: points,
      suggestion: issue ? '確認できる事実（許可・資格・対応エリア・沿革など）を整理し、実績は掲載許諾を得たものから追加できる枠を用意する' : '',
      suggestionSource: 'rule',
      evidenceUrl: u,
      screenshotKind: null,
      policy: '実績は架空のものを作らず「掲載予定領域」として示しています',
    });
  }

  // 6. ページ構造・表示速度
  {
    const facts: string[] = [];
    const points: string[] = [];
    let issue = false;
    const flag = (x: string) => (facts.push(x), points.push(x), (issue = true));
    facts.push(`HTML ${Math.round(top.htmlBytes / 1024)}KB、画像 ${top.imgCount} 点（alt なし ${top.imgWithoutAlt} 点）`);
    if (top.imgWithoutAlt > 0) points.push(`代替テキスト（alt）のない画像が ${top.imgWithoutAlt} 点あります`), (issue = true);
    if (!top.h1.length || !top.h2.length) {
      flag('見出し階層（h1/h2）が整っていません');
    }
    if (!top.metaDescription) {
      flag('meta description がありません');
    }
    const t = pc?.metrics.navTiming;
    if (t) facts.push(`実測（Playwright Navigation Timing・参考値）: DOMContentLoaded ${t.domContentLoadedMs}ms / load ${t.loadMs}ms`);
    facts.push('Lighthouse スコアは未計測');
    f.push({
      category: 6,
      status: issue ? 'issue' : 'good',
      fact: facts.join('。'),
      issuePoints: points,
      suggestion: issue ? '見出し構造と画像の代替テキスト、ページ説明文を整備し、画像は表示サイズに合わせて最適化する' : '',
      suggestionSource: 'rule',
      evidenceUrl: u,
      screenshotKind: null,
      policy: '見出し構造と画像の代替テキストを整えた構成にしています（独自スコアは付けていません）',
    });
  }

  // 7. デザイン
  {
    const facts: string[] = [];
    const points: string[] = [];
    let issue = false;
    const flag = (x: string) => (facts.push(x), points.push(x), (issue = true));
    if (top.tableLayout) {
      flag('表（table）要素でページ全体をレイアウトしています');
    }
    if (top.legacyTags.length) {
      flag(`旧式のタグを使用: ${top.legacyTags.join(', ')}`);
    }
    if (top.copyrightYear && top.copyrightYear <= year - 5) {
      flag(`著作権表記の年が ${top.copyrightYear} 年`);
    }
    if (top.latestDateYear && top.latestDateYear <= year - 3) {
      flag(`本文中の最新日付が ${top.latestDateYear} 年（更新が止まって見える可能性）`);
    }
    if (top.colors.length) facts.push(`サイトで使われている色: ${top.colors.slice(0, 3).join(', ')}`);
    f.push({
      category: 7,
      status: issue ? 'issue' : pc ? 'good' : 'unverified',
      fact: facts.join('。') || '目立った旧式要素は検出されませんでした（目視確認は未実施）',
      issuePoints: points,
      suggestion: issue ? '既存のブランドカラーを活かしつつ、余白・文字組み・写真枠を整理した現代的なレイアウトにする' : '',
      suggestionSource: 'rule',
      evidenceUrl: u,
      screenshotKind: 'pc',
      policy: '確認できたブランドカラーを活かしたデザインにしています',
    });
  }
  return f;
}
