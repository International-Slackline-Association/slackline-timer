// Hand-written declarations for renamePlan.mjs (same arrangement as fieldBounds.d.mts).

export type StoredItem = Record<string, unknown> & { PK?: unknown; SK?: unknown };

export interface PhotoMove {
  oldKey: string;
  newKey: string;
}

export interface ReverseGrant {
  put: { PK: string; SK: string; compId: string; sub: string };
  oldKey: { PK: string; SK: string };
}

export interface RenamePlan {
  newItems: StoredItem[];
  photoMoves: PhotoMove[];
  foreignPhotos: number;
  reverseGrants: ReverseGrant[];
}

export declare const compPk: (id: string) => string;
export declare const photoPrefix: (id: string) => string;

export declare function planRename(
  source: StoredItem[],
  from: string,
  to: string,
  opts?: { skipPhotos?: boolean },
): RenamePlan;

export declare function isPriorCopy(targetItems: StoredItem[], plannedItems: StoredItem[]): boolean;
