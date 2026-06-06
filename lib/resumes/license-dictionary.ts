/**
 * 履歴書「免許・資格」欄のオートコンプリート用辞書
 *
 * - 静的データ(AIは使わない)。捏造を避けるため候補に出すだけで、
 *   入力は常に自由(候補に無くても本人が手で書ける)。
 * - name は正式名称ベース。略称・通称は aliases に入れて検索ヒットさせる。
 * - 主要な国家資格・公的資格・主要な民間資格を網羅。マイナーすぎるものは含めない。
 */

export type LicenseDictionaryItem = {
  /** 正式名称(候補クリック時に入力される文字列) */
  name: string;
  /** 大分類。検索結果のグルーピング表示に使う可能性を残して保持。 */
  category: string;
  /** 略称・通称・別綴り。検索ヒット用。 */
  aliases?: string[];
};

export const licenseDictionary: LicenseDictionaryItem[] = [
  // ============================================
  // 運転・操縦
  // ============================================
  {
    name: "普通自動車第一種運転免許",
    category: "運転",
    aliases: ["普通免許", "運転免許", "普通自動車免許", "普通一種"],
  },
  {
    name: "普通自動車第一種運転免許(AT限定)",
    category: "運転",
    aliases: ["AT限定", "オートマ限定", "AT"],
  },
  {
    name: "普通自動車第二種運転免許",
    category: "運転",
    aliases: ["普通二種", "二種免許"],
  },
  { name: "準中型自動車第一種運転免許", category: "運転", aliases: ["準中型免許"] },
  { name: "中型自動車第一種運転免許", category: "運転", aliases: ["中型免許"] },
  { name: "中型自動車第二種運転免許", category: "運転", aliases: ["中型二種"] },
  { name: "大型自動車第一種運転免許", category: "運転", aliases: ["大型免許", "大型一種"] },
  { name: "大型自動車第二種運転免許", category: "運転", aliases: ["大型二種"] },
  { name: "大型特殊自動車第一種運転免許", category: "運転", aliases: ["大特", "大型特殊"] },
  { name: "大型特殊自動車第二種運転免許", category: "運転", aliases: ["大特二種"] },
  { name: "普通自動二輪車運転免許", category: "運転", aliases: ["普通二輪", "中型バイク"] },
  { name: "大型自動二輪車運転免許", category: "運転", aliases: ["大型二輪", "大型バイク"] },
  { name: "小型特殊自動車運転免許", category: "運転", aliases: ["小特"] },
  { name: "原動機付自転車運転免許", category: "運転", aliases: ["原付", "原付免許"] },
  { name: "牽引第一種運転免許", category: "運転", aliases: ["牽引免許", "けん引"] },
  { name: "牽引第二種運転免許", category: "運転", aliases: ["牽引二種", "けん引二種"] },
  { name: "一級小型船舶操縦士", category: "運転", aliases: ["船舶免許", "小型船舶"] },
  { name: "二級小型船舶操縦士", category: "運転", aliases: ["小型船舶2級"] },
  { name: "特殊小型船舶操縦士", category: "運転", aliases: ["水上バイク免許", "ジェットスキー"] },

  // ============================================
  // 法律・士業
  // ============================================
  { name: "弁護士", category: "法律・士業", aliases: ["bengoshi"] },
  { name: "司法書士", category: "法律・士業" },
  { name: "行政書士", category: "法律・士業" },
  { name: "社会保険労務士", category: "法律・士業", aliases: ["社労士"] },
  { name: "税理士", category: "法律・士業" },
  { name: "公認会計士", category: "法律・士業", aliases: ["会計士", "CPA"] },
  { name: "弁理士", category: "法律・士業" },
  { name: "中小企業診断士", category: "法律・士業", aliases: ["診断士"] },
  { name: "宅地建物取引士", category: "法律・士業", aliases: ["宅建", "宅建士"] },
  { name: "不動産鑑定士", category: "法律・士業" },
  { name: "土地家屋調査士", category: "法律・士業" },
  { name: "通関士", category: "法律・士業" },
  { name: "海事代理士", category: "法律・士業" },
  { name: "マンション管理士", category: "法律・士業", aliases: ["マン管"] },
  { name: "管理業務主任者", category: "法律・士業", aliases: ["管業"] },
  { name: "賃貸不動産経営管理士", category: "法律・士業", aliases: ["賃貸不動産"] },
  { name: "司法試験予備試験", category: "法律・士業", aliases: ["予備試験"] },

  // ============================================
  // 会計・簿記・金融
  // ============================================
  {
    name: "日商簿記検定1級",
    category: "会計・簿記",
    aliases: ["簿記1級", "簿記", "日商簿記"],
  },
  {
    name: "日商簿記検定2級",
    category: "会計・簿記",
    aliases: ["簿記2級", "簿記", "日商簿記"],
  },
  {
    name: "日商簿記検定3級",
    category: "会計・簿記",
    aliases: ["簿記3級", "簿記", "日商簿記"],
  },
  {
    name: "日商簿記初級",
    category: "会計・簿記",
    aliases: ["簿記初級", "日商簿記"],
  },
  {
    name: "全経簿記能力検定上級",
    category: "会計・簿記",
    aliases: ["全経簿記上級"],
  },
  {
    name: "BATIC(国際会計検定)",
    category: "会計・簿記",
    aliases: ["BATIC", "国際会計検定"],
  },
  { name: "建設業経理士1級", category: "会計・簿記", aliases: ["建設業経理"] },
  { name: "建設業経理士2級", category: "会計・簿記", aliases: ["建設業経理"] },
  {
    name: "ファイナンシャル・プランニング技能士1級",
    category: "金融",
    aliases: ["FP1級", "FP", "ファイナンシャルプランナー"],
  },
  {
    name: "ファイナンシャル・プランニング技能士2級",
    category: "金融",
    aliases: ["FP2級", "FP", "ファイナンシャルプランナー"],
  },
  {
    name: "ファイナンシャル・プランニング技能士3級",
    category: "金融",
    aliases: ["FP3級", "FP", "ファイナンシャルプランナー"],
  },
  { name: "AFP認定", category: "金融", aliases: ["AFP"] },
  { name: "CFP認定", category: "金融", aliases: ["CFP"] },
  {
    name: "証券外務員一種",
    category: "金融",
    aliases: ["外務員一種", "証券外務員"],
  },
  {
    name: "証券外務員二種",
    category: "金融",
    aliases: ["外務員二種", "証券外務員"],
  },
  { name: "内部管理責任者", category: "金融" },
  { name: "DCプランナー1級", category: "金融", aliases: ["DCプランナー"] },
  { name: "DCプランナー2級", category: "金融", aliases: ["DCプランナー"] },
  { name: "貸金業務取扱主任者", category: "金融", aliases: ["貸金業"] },
  { name: "銀行業務検定", category: "金融" },

  // ============================================
  // IT・情報処理
  // ============================================
  { name: "ITパスポート試験", category: "IT", aliases: ["ITパスポート", "iパス", "IP"] },
  {
    name: "情報セキュリティマネジメント試験",
    category: "IT",
    aliases: ["セキュマネ", "SG"],
  },
  { name: "基本情報技術者試験", category: "IT", aliases: ["基本情報", "FE"] },
  { name: "応用情報技術者試験", category: "IT", aliases: ["応用情報", "AP"] },
  {
    name: "情報処理安全確保支援士",
    category: "IT",
    aliases: ["登録セキスペ", "セキスペ", "SC"],
  },
  { name: "ネットワークスペシャリスト試験", category: "IT", aliases: ["NW", "ネスペ"] },
  {
    name: "データベーススペシャリスト試験",
    category: "IT",
    aliases: ["DB", "デスペ"],
  },
  {
    name: "エンベデッドシステムスペシャリスト試験",
    category: "IT",
    aliases: ["ES", "エンベ"],
  },
  { name: "システムアーキテクト試験", category: "IT", aliases: ["SA"] },
  { name: "プロジェクトマネージャ試験", category: "IT", aliases: ["PM"] },
  { name: "ITサービスマネージャ試験", category: "IT", aliases: ["SM"] },
  { name: "ITストラテジスト試験", category: "IT", aliases: ["ST"] },
  { name: "システム監査技術者試験", category: "IT", aliases: ["AU"] },
  {
    name: "AWS Certified Cloud Practitioner",
    category: "IT",
    aliases: ["AWS", "AWS認定", "CLF"],
  },
  {
    name: "AWS Certified Solutions Architect - Associate",
    category: "IT",
    aliases: ["AWS SAA", "AWSソリューションアーキテクト"],
  },
  {
    name: "AWS Certified Solutions Architect - Professional",
    category: "IT",
    aliases: ["AWS SAP"],
  },
  { name: "AWS Certified Developer - Associate", category: "IT", aliases: ["AWS DVA"] },
  {
    name: "AWS Certified SysOps Administrator - Associate",
    category: "IT",
    aliases: ["AWS SOA"],
  },
  { name: "Microsoft Certified: Azure Fundamentals", category: "IT", aliases: ["AZ-900", "Azure"] },
  {
    name: "Microsoft Certified: Azure Administrator Associate",
    category: "IT",
    aliases: ["AZ-104"],
  },
  {
    name: "Microsoft Certified: Azure Developer Associate",
    category: "IT",
    aliases: ["AZ-204"],
  },
  {
    name: "Google Cloud Certified - Associate Cloud Engineer",
    category: "IT",
    aliases: ["GCP", "Google Cloud"],
  },
  {
    name: "Google Cloud Certified - Professional Cloud Architect",
    category: "IT",
    aliases: ["PCA", "GCP"],
  },
  { name: "Oracle Master Bronze DBA", category: "IT", aliases: ["Oracle Bronze", "ORACLE MASTER"] },
  { name: "Oracle Master Silver DBA", category: "IT", aliases: ["Oracle Silver"] },
  { name: "Oracle Master Gold DBA", category: "IT", aliases: ["Oracle Gold"] },
  {
    name: "Oracle Certified Java Programmer, Bronze SE",
    category: "IT",
    aliases: ["Java Bronze", "OCJP Bronze"],
  },
  {
    name: "Oracle Certified Java Programmer, Silver SE",
    category: "IT",
    aliases: ["Java Silver", "OCJP Silver"],
  },
  {
    name: "Oracle Certified Java Programmer, Gold SE",
    category: "IT",
    aliases: ["Java Gold", "OCJP Gold"],
  },
  { name: "LPIC Level 1", category: "IT", aliases: ["LPIC", "LPIC-1"] },
  { name: "LPIC Level 2", category: "IT", aliases: ["LPIC-2"] },
  { name: "LPIC Level 3", category: "IT", aliases: ["LPIC-3"] },
  { name: "LinuC レベル1", category: "IT", aliases: ["LinuC", "LinuC-1"] },
  { name: "LinuC レベル2", category: "IT", aliases: ["LinuC-2"] },
  { name: "LinuC レベル3", category: "IT", aliases: ["LinuC-3"] },
  { name: "CCNA", category: "IT", aliases: ["Cisco CCNA"] },
  { name: "CCNP", category: "IT", aliases: ["Cisco CCNP"] },
  { name: "CompTIA A+", category: "IT", aliases: ["CompTIA"] },
  { name: "CompTIA Network+", category: "IT", aliases: ["Network+"] },
  { name: "CompTIA Security+", category: "IT", aliases: ["Security+"] },
  { name: "CISSP", category: "IT" },
  { name: "PMP", category: "IT", aliases: ["プロジェクトマネジメント・プロフェッショナル"] },
  { name: "統計検定1級", category: "IT", aliases: ["統計検定"] },
  { name: "統計検定準1級", category: "IT", aliases: ["統計検定"] },
  { name: "統計検定2級", category: "IT", aliases: ["統計検定"] },
  { name: "G検定(JDLA Deep Learning for GENERAL)", category: "IT", aliases: ["G検定", "JDLA"] },
  { name: "E資格(JDLA Deep Learning for ENGINEER)", category: "IT", aliases: ["E資格", "JDLA"] },

  // ============================================
  // 語学
  // ============================================
  {
    name: "TOEIC Listening & Reading Test",
    category: "語学",
    aliases: ["TOEIC", "トーイック", "TOEIC L&R"],
  },
  {
    name: "TOEIC Speaking & Writing Tests",
    category: "語学",
    aliases: ["TOEIC SW", "TOEIC S&W"],
  },
  { name: "TOEFL iBT", category: "語学", aliases: ["TOEFL"] },
  { name: "IELTS", category: "語学", aliases: ["アイエルツ"] },
  {
    name: "実用英語技能検定1級",
    category: "語学",
    aliases: ["英検1級", "英検"],
  },
  { name: "実用英語技能検定準1級", category: "語学", aliases: ["英検準1級", "英検"] },
  { name: "実用英語技能検定2級", category: "語学", aliases: ["英検2級", "英検"] },
  { name: "実用英語技能検定準2級", category: "語学", aliases: ["英検準2級", "英検"] },
  { name: "実用英語技能検定3級", category: "語学", aliases: ["英検3級", "英検"] },
  { name: "ケンブリッジ英語検定", category: "語学", aliases: ["ケンブリッジ英検"] },
  { name: "国連英検", category: "語学", aliases: ["国際連合公用語英語検定"] },
  {
    name: "日本語能力試験N1",
    category: "語学",
    aliases: ["JLPT N1", "JLPT", "日本語能力試験"],
  },
  { name: "日本語能力試験N2", category: "語学", aliases: ["JLPT N2", "JLPT"] },
  { name: "日本語能力試験N3", category: "語学", aliases: ["JLPT N3", "JLPT"] },
  { name: "BJTビジネス日本語能力テスト", category: "語学", aliases: ["BJT"] },
  { name: "中国語検定試験1級", category: "語学", aliases: ["中検1級", "中国語検定", "中検"] },
  { name: "中国語検定試験準1級", category: "語学", aliases: ["中検準1級", "中検"] },
  { name: "中国語検定試験2級", category: "語学", aliases: ["中検2級", "中検"] },
  { name: "中国語検定試験3級", category: "語学", aliases: ["中検3級", "中検"] },
  { name: "HSK6級", category: "語学", aliases: ["HSK"] },
  { name: "HSK5級", category: "語学", aliases: ["HSK"] },
  { name: "HSK4級", category: "語学", aliases: ["HSK"] },
  {
    name: "韓国語能力試験(TOPIK)II",
    category: "語学",
    aliases: ["TOPIK", "韓国語能力試験"],
  },
  { name: "韓国語能力試験(TOPIK)I", category: "語学", aliases: ["TOPIK"] },
  {
    name: "ハングル能力検定1級",
    category: "語学",
    aliases: ["ハン検", "ハングル検定"],
  },
  { name: "ハングル能力検定2級", category: "語学", aliases: ["ハン検", "ハングル検定"] },
  { name: "ドイツ語技能検定1級", category: "語学", aliases: ["独検", "ドイツ語検定"] },
  { name: "ドイツ語技能検定2級", category: "語学", aliases: ["独検"] },
  { name: "実用フランス語技能検定1級", category: "語学", aliases: ["仏検", "フランス語検定"] },
  { name: "実用フランス語技能検定準1級", category: "語学", aliases: ["仏検"] },
  { name: "実用フランス語技能検定2級", category: "語学", aliases: ["仏検"] },
  { name: "DELF B2", category: "語学", aliases: ["DELF"] },
  { name: "DALF C1", category: "語学", aliases: ["DALF"] },
  { name: "スペイン語技能検定", category: "語学", aliases: ["西検"] },
  { name: "DELE B2", category: "語学", aliases: ["DELE"] },
  { name: "ロシア語能力検定", category: "語学", aliases: ["露検"] },
  { name: "実用イタリア語検定", category: "語学", aliases: ["伊検", "イタリア語検定"] },

  // ============================================
  // 医療・福祉
  // ============================================
  { name: "医師", category: "医療", aliases: ["医師免許"] },
  { name: "歯科医師", category: "医療" },
  { name: "薬剤師", category: "医療" },
  { name: "看護師", category: "医療" },
  { name: "准看護師", category: "医療" },
  { name: "助産師", category: "医療" },
  { name: "保健師", category: "医療" },
  { name: "理学療法士", category: "医療", aliases: ["PT"] },
  { name: "作業療法士", category: "医療", aliases: ["OT"] },
  { name: "言語聴覚士", category: "医療", aliases: ["ST"] },
  { name: "臨床検査技師", category: "医療" },
  { name: "臨床工学技士", category: "医療", aliases: ["CE"] },
  { name: "診療放射線技師", category: "医療" },
  { name: "視能訓練士", category: "医療" },
  { name: "義肢装具士", category: "医療" },
  { name: "救急救命士", category: "医療" },
  { name: "歯科衛生士", category: "医療" },
  { name: "歯科技工士", category: "医療" },
  { name: "あん摩マッサージ指圧師", category: "医療", aliases: ["あん摩", "マッサージ"] },
  { name: "はり師", category: "医療", aliases: ["鍼師"] },
  { name: "きゅう師", category: "医療", aliases: ["灸師"] },
  { name: "柔道整復師", category: "医療" },
  { name: "介護福祉士", category: "福祉" },
  { name: "社会福祉士", category: "福祉" },
  { name: "精神保健福祉士", category: "福祉", aliases: ["PSW"] },
  { name: "介護支援専門員", category: "福祉", aliases: ["ケアマネ", "ケアマネージャー"] },
  {
    name: "介護職員初任者研修",
    category: "福祉",
    aliases: ["初任者研修", "ヘルパー2級"],
  },
  { name: "介護福祉士実務者研修", category: "福祉", aliases: ["実務者研修"] },
  { name: "公認心理師", category: "福祉" },
  { name: "臨床心理士", category: "福祉" },
  { name: "保育士", category: "福祉" },

  // ============================================
  // 食品・調理・栄養
  // ============================================
  { name: "調理師", category: "食品" },
  { name: "製菓衛生師", category: "食品" },
  { name: "管理栄養士", category: "食品" },
  { name: "栄養士", category: "食品" },
  { name: "食品衛生責任者", category: "食品" },
  { name: "食品衛生管理者", category: "食品" },
  { name: "ふぐ調理師", category: "食品", aliases: ["フグ調理師"] },
  { name: "ソムリエ(J.S.A.認定)", category: "食品", aliases: ["ソムリエ"] },
  { name: "野菜ソムリエ", category: "食品" },

  // ============================================
  // 建築・土木・施工管理
  // ============================================
  { name: "一級建築士", category: "建築・土木" },
  { name: "二級建築士", category: "建築・土木" },
  { name: "木造建築士", category: "建築・土木" },
  { name: "一級建築施工管理技士", category: "建築・土木", aliases: ["建築施工"] },
  { name: "二級建築施工管理技士", category: "建築・土木", aliases: ["建築施工"] },
  { name: "一級土木施工管理技士", category: "建築・土木", aliases: ["土木施工"] },
  { name: "二級土木施工管理技士", category: "建築・土木", aliases: ["土木施工"] },
  { name: "一級電気工事施工管理技士", category: "建築・土木", aliases: ["電気施工"] },
  { name: "二級電気工事施工管理技士", category: "建築・土木", aliases: ["電気施工"] },
  { name: "一級管工事施工管理技士", category: "建築・土木", aliases: ["管工事"] },
  { name: "二級管工事施工管理技士", category: "建築・土木", aliases: ["管工事"] },
  { name: "一級造園施工管理技士", category: "建築・土木", aliases: ["造園施工"] },
  { name: "二級造園施工管理技士", category: "建築・土木", aliases: ["造園施工"] },
  { name: "一級建設機械施工管理技士", category: "建築・土木" },
  { name: "二級建設機械施工管理技士", category: "建築・土木" },
  { name: "一級電気通信工事施工管理技士", category: "建築・土木" },
  { name: "二級電気通信工事施工管理技士", category: "建築・土木" },
  { name: "測量士", category: "建築・土木" },
  { name: "測量士補", category: "建築・土木" },
  { name: "インテリアコーディネーター", category: "建築・土木", aliases: ["IC"] },
  { name: "インテリアプランナー", category: "建築・土木" },
  { name: "福祉住環境コーディネーター1級", category: "建築・土木", aliases: ["福祉住環境"] },
  { name: "福祉住環境コーディネーター2級", category: "建築・土木", aliases: ["福祉住環境"] },
  { name: "福祉住環境コーディネーター3級", category: "建築・土木", aliases: ["福祉住環境"] },

  // ============================================
  // 電気・無線・通信
  // ============================================
  { name: "第一種電気工事士", category: "電気・無線" },
  { name: "第二種電気工事士", category: "電気・無線" },
  { name: "第一種電気主任技術者", category: "電気・無線", aliases: ["電験一種"] },
  { name: "第二種電気主任技術者", category: "電気・無線", aliases: ["電験二種"] },
  { name: "第三種電気主任技術者", category: "電気・無線", aliases: ["電験三種", "電験"] },
  { name: "電気通信主任技術者", category: "電気・無線" },
  { name: "工事担任者", category: "電気・無線" },
  { name: "第一級陸上特殊無線技士", category: "電気・無線", aliases: ["一陸特"] },
  { name: "第二級陸上特殊無線技士", category: "電気・無線", aliases: ["二陸特"] },
  { name: "第三級陸上特殊無線技士", category: "電気・無線", aliases: ["三陸特"] },
  { name: "第一級海上特殊無線技士", category: "電気・無線", aliases: ["一海特"] },
  { name: "第一級アマチュア無線技士", category: "電気・無線", aliases: ["一アマ"] },
  { name: "第二級アマチュア無線技士", category: "電気・無線", aliases: ["二アマ"] },
  { name: "第三級アマチュア無線技士", category: "電気・無線", aliases: ["三アマ"] },
  { name: "第四級アマチュア無線技士", category: "電気・無線", aliases: ["四アマ"] },

  // ============================================
  // 危険物・安全・設備
  // ============================================
  { name: "危険物取扱者 甲種", category: "危険物・安全", aliases: ["危険物甲種", "危険物"] },
  {
    name: "危険物取扱者 乙種第4類",
    category: "危険物・安全",
    aliases: ["乙4", "危険物乙4", "危険物"],
  },
  {
    name: "危険物取扱者 乙種第1類",
    category: "危険物・安全",
    aliases: ["乙1", "危険物乙1"],
  },
  {
    name: "危険物取扱者 乙種第2類",
    category: "危険物・安全",
    aliases: ["乙2", "危険物乙2"],
  },
  {
    name: "危険物取扱者 乙種第3類",
    category: "危険物・安全",
    aliases: ["乙3", "危険物乙3"],
  },
  {
    name: "危険物取扱者 乙種第5類",
    category: "危険物・安全",
    aliases: ["乙5", "危険物乙5"],
  },
  {
    name: "危険物取扱者 乙種第6類",
    category: "危険物・安全",
    aliases: ["乙6", "危険物乙6"],
  },
  { name: "危険物取扱者 丙種", category: "危険物・安全", aliases: ["丙種", "危険物"] },
  { name: "特級ボイラー技士", category: "危険物・安全", aliases: ["ボイラー"] },
  { name: "一級ボイラー技士", category: "危険物・安全", aliases: ["ボイラー"] },
  { name: "二級ボイラー技士", category: "危険物・安全", aliases: ["ボイラー"] },
  { name: "第一種冷凍機械責任者", category: "危険物・安全", aliases: ["冷凍"] },
  { name: "第二種冷凍機械責任者", category: "危険物・安全", aliases: ["冷凍"] },
  { name: "第三種冷凍機械責任者", category: "危険物・安全", aliases: ["冷凍"] },
  { name: "第一種衛生管理者", category: "危険物・安全", aliases: ["衛生管理者"] },
  { name: "第二種衛生管理者", category: "危険物・安全", aliases: ["衛生管理者"] },
  { name: "毒物劇物取扱責任者", category: "危険物・安全", aliases: ["毒劇"] },
  { name: "甲種防火管理者", category: "危険物・安全", aliases: ["防火管理者"] },
  { name: "乙種防火管理者", category: "危険物・安全", aliases: ["防火管理者"] },
  { name: "防災管理者", category: "危険物・安全" },
  { name: "消防設備士 甲種第4類", category: "危険物・安全", aliases: ["消防設備士"] },
  { name: "消防設備士 乙種第6類", category: "危険物・安全", aliases: ["消防設備士"] },
  { name: "高圧ガス製造保安責任者(甲種化学)", category: "危険物・安全", aliases: ["高圧ガス"] },
  { name: "高圧ガス製造保安責任者(乙種化学)", category: "危険物・安全", aliases: ["高圧ガス"] },

  // ============================================
  // 技能講習・作業免許
  // ============================================
  {
    name: "フォークリフト運転技能講習",
    category: "技能",
    aliases: ["フォークリフト"],
  },
  {
    name: "玉掛け技能講習",
    category: "技能",
    aliases: ["玉掛け"],
  },
  {
    name: "小型移動式クレーン運転技能講習",
    category: "技能",
    aliases: ["小型クレーン", "移動式クレーン"],
  },
  {
    name: "床上操作式クレーン運転技能講習",
    category: "技能",
    aliases: ["床上クレーン"],
  },
  { name: "クレーン・デリック運転士", category: "技能", aliases: ["クレーン運転士"] },
  {
    name: "高所作業車運転技能講習",
    category: "技能",
    aliases: ["高所作業車"],
  },
  {
    name: "車両系建設機械(整地等)運転技能講習",
    category: "技能",
    aliases: ["車両系建設機械", "ユンボ"],
  },
  { name: "ガス溶接技能講習", category: "技能", aliases: ["ガス溶接"] },
  { name: "アーク溶接特別教育", category: "技能", aliases: ["アーク溶接"] },

  // ============================================
  // 事務・ビジネス
  // ============================================
  {
    name: "MOS Word",
    category: "事務",
    aliases: ["MOS", "マイクロソフト オフィス スペシャリスト", "Microsoft Office Specialist"],
  },
  { name: "MOS Excel", category: "事務", aliases: ["MOS", "Microsoft Office Specialist"] },
  { name: "MOS PowerPoint", category: "事務", aliases: ["MOS"] },
  { name: "MOS Word Expert", category: "事務", aliases: ["MOS Expert"] },
  { name: "MOS Excel Expert", category: "事務", aliases: ["MOS Expert"] },
  { name: "秘書検定1級", category: "事務", aliases: ["秘書検定", "秘書"] },
  { name: "秘書検定準1級", category: "事務", aliases: ["秘書検定"] },
  { name: "秘書検定2級", category: "事務", aliases: ["秘書検定"] },
  { name: "秘書検定3級", category: "事務", aliases: ["秘書検定"] },
  {
    name: "ビジネス実務法務検定1級",
    category: "事務",
    aliases: ["ビジネス実務法務", "ビジ法"],
  },
  {
    name: "ビジネス実務法務検定2級",
    category: "事務",
    aliases: ["ビジネス実務法務", "ビジ法"],
  },
  {
    name: "ビジネス実務法務検定3級",
    category: "事務",
    aliases: ["ビジネス実務法務", "ビジ法"],
  },
  { name: "日商PC検定", category: "事務", aliases: ["PC検定"] },
  { name: "ビジネス文書検定", category: "事務" },
  { name: "知的財産管理技能士1級", category: "事務", aliases: ["知財", "知的財産"] },
  { name: "知的財産管理技能士2級", category: "事務", aliases: ["知財", "知的財産"] },
  { name: "知的財産管理技能士3級", category: "事務", aliases: ["知財", "知的財産"] },
  {
    name: "メンタルヘルス・マネジメント検定I種(マスターコース)",
    category: "事務",
    aliases: ["メンタルヘルス"],
  },
  {
    name: "メンタルヘルス・マネジメント検定II種(ラインケアコース)",
    category: "事務",
    aliases: ["メンタルヘルス"],
  },
  {
    name: "メンタルヘルス・マネジメント検定III種(セルフケアコース)",
    category: "事務",
    aliases: ["メンタルヘルス"],
  },
  { name: "個人情報保護士", category: "事務" },

  // ============================================
  // 教育・図書・観光
  // ============================================
  { name: "小学校教諭一種免許状", category: "教育", aliases: ["小学校教諭", "教員免許"] },
  { name: "中学校教諭一種免許状", category: "教育", aliases: ["中学校教諭", "教員免許"] },
  { name: "高等学校教諭一種免許状", category: "教育", aliases: ["高校教諭", "教員免許"] },
  { name: "幼稚園教諭一種免許状", category: "教育", aliases: ["幼稚園教諭"] },
  { name: "特別支援学校教諭一種免許状", category: "教育", aliases: ["特別支援"] },
  { name: "司書", category: "教育", aliases: ["図書館司書"] },
  { name: "司書教諭", category: "教育" },
  { name: "学芸員", category: "教育" },
  { name: "総合旅行業務取扱管理者", category: "観光", aliases: ["旅行業", "総合旅行"] },
  { name: "国内旅行業務取扱管理者", category: "観光", aliases: ["旅行業", "国内旅行"] },
  { name: "全国通訳案内士", category: "観光", aliases: ["通訳案内士"] },
  { name: "旅程管理主任者", category: "観光", aliases: ["ツアーコンダクター", "添乗員"] },

  // ============================================
  // 美容・理容・その他
  // ============================================
  { name: "美容師", category: "美容" },
  { name: "理容師", category: "美容" },
  { name: "ネイリスト技能検定1級", category: "美容", aliases: ["ネイリスト", "ネイル検定"] },
  { name: "ネイリスト技能検定2級", category: "美容", aliases: ["ネイリスト", "ネイル検定"] },
  { name: "ネイリスト技能検定3級", category: "美容", aliases: ["ネイリスト", "ネイル検定"] },
  { name: "色彩検定1級", category: "デザイン", aliases: ["色彩"] },
  { name: "色彩検定2級", category: "デザイン", aliases: ["色彩"] },
  { name: "色彩検定3級", category: "デザイン", aliases: ["色彩"] },
  { name: "色彩検定UC級", category: "デザイン", aliases: ["色彩"] },
  { name: "カラーコーディネーター検定", category: "デザイン" },
  {
    name: "Adobe Certified Professional",
    category: "デザイン",
    aliases: ["ACP", "Adobe認定"],
  },

  // ============================================
  // 警備・防犯
  // ============================================
  { name: "警備員指導教育責任者", category: "警備" },
  { name: "施設警備業務検定1級", category: "警備", aliases: ["施設警備"] },
  { name: "施設警備業務検定2級", category: "警備", aliases: ["施設警備"] },
  { name: "交通誘導警備業務検定1級", category: "警備", aliases: ["交通誘導"] },
  { name: "交通誘導警備業務検定2級", category: "警備", aliases: ["交通誘導"] },
];

/**
 * 入力文字列に部分一致する候補を返す。
 *
 * - name と aliases の双方を見る(略称や英字略号からも引けるように)。
 * - 大文字小文字は無視。
 * - 空クエリは候補なし(全件出すと操作の邪魔になる)。
 * - 同じ name は重複させない(複数 alias がヒットしても1件として返す)。
 *
 * limit は UI 側で件数を絞りたい場合のみ渡す。
 * 未指定なら全候補を返し、ドロップダウン側のスクロールで閲覧する想定。
 * 辞書サイズは数百件なので、レンダリングコストは現実的に問題にならない。
 */
export function searchLicenses(query: string, limit?: number): LicenseDictionaryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const seen = new Set<string>();
  const results: LicenseDictionaryItem[] = [];
  for (const item of licenseDictionary) {
    if (seen.has(item.name)) continue;
    const hitName = item.name.toLowerCase().includes(q);
    const hitAlias = item.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false;
    if (hitName || hitAlias) {
      seen.add(item.name);
      results.push(item);
      if (limit !== undefined && results.length >= limit) break;
    }
  }
  return results;
}
