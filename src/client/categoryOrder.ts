export function reorderCategoryKeys(
  orderedCategories: string[],
  sourceCategory: string,
  targetCategory: string,
  insertAfterTarget: boolean
) {
  if (!sourceCategory || !targetCategory || sourceCategory === targetCategory) return orderedCategories;
  if (!orderedCategories.includes(sourceCategory) || !orderedCategories.includes(targetCategory)) return orderedCategories;

  const nextOrder = orderedCategories.filter(category => category !== sourceCategory);
  let targetIndex = nextOrder.indexOf(targetCategory);
  if (insertAfterTarget) targetIndex += 1;
  nextOrder.splice(targetIndex, 0, sourceCategory);

  return nextOrder.every((category, index) => category === orderedCategories[index])
    ? orderedCategories
    : nextOrder;
}
