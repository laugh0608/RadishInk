import { create } from "zustand";
/** 图片选择、解码与写入期间，文章包不能捕获不完整的插入结果。 */
export const useArticleTransferState = create<{
  imageBusy: boolean;
  fileBusy: boolean;
}>(() => ({
  imageBusy: false,
  fileBusy: false,
}));
