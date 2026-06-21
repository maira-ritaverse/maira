/**
 * カスタマイズ可能サイドバーのデータ型
 *
 * ItemDescriptor:そのページに存在しうるナビ項目の定義(全候補)
 *   - id は href とは別に持つ stable identifier(URL 変更に強い)
 *   - icon は項目固有のもの(項目には必要)
 *
 * GroupDescriptor:ユーザが作るグループ
 *   - title のみ(アイコンは持たない。視覚ノイズを減らす方針)
 *   - itemIds の順序がグループ内の表示順
 *
 * SidebarLayout:ユーザの状態
 *   - topLevelItemIds:トップに直接表示する項目(順序保持)
 *   - groups:グループの並び順(これも順序保持)+ それぞれの内部順序
 *   - hiddenItemIds:非表示にした項目(編集モードでだけ見せる)
 *   - 全 item は (topLevel ∪ groups[*].items ∪ hidden) で一意に分配される
 */

export type ItemDescriptor = {
  id: string;
  href: string;
  icon: string;
  defaultLabel: string;
  /** オンボーディングツアー等で使う追加属性 */
  dataAttr?: string;
};

export type GroupDescriptor = {
  id: string;
  /** タイトル。 null の 場合 は タイトル 行 を 出さず、 中身 を フラット に 並べる
   *  (= 単に 順番 制御 用 の 区切り として 使う)。 */
  title: string | null;
  itemIds: string[];
};

export type SidebarLayout = {
  topLevelItemIds: string[];
  groups: GroupDescriptor[];
  hiddenItemIds: string[];
};
