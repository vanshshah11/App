import {getChangedFieldsRevert} from '@libs/actions/IOU/UpdateMoneyRequest';

import type * as OnyxTypes from '@src/types/onyx';
import type {TransactionChanges} from '@src/types/onyx/Transaction';

/**
 * Unit tests for the field-scoped failureData revert (#106153).
 *
 * Background: when a queued UPDATE_MONEY_REQUEST_* write exhausted retries, the failureData revert
 * used to spread the WHOLE queued transaction snapshot (`...transaction`), clobbering edits made AFTER
 * the write was queued (e.g. a receipt attached or a new description typed while a merchant write was
 * retrying). The fix reverts ONLY the fields the command changed, so later edits survive.
 */
describe('getChangedFieldsRevert', () => {
    it('reverts only the merchant field so a later description edit survives the failure revert', () => {
        // Given a queued transaction snapshot whose merchant field the command changed
        const queuedSnapshot: OnyxTypes.Transaction = {
            transactionID: 'txnA',
            amount: 1000,
            currency: 'USD',
            merchant: 'Old Merchant',
            comment: {comment: 'old receipt filename'},
            reportID: 'r1',
            created: '2024-01-01',
            type: 'TRIP',
        } as unknown as OnyxTypes.Transaction;
        // And a merchant-only change (the command that failed + exhausted retries)
        const transactionChanges: TransactionChanges = {merchant: 'New Merchant'};

        // When the field-scoped revert value is built
        const revert = getChangedFieldsRevert(queuedSnapshot, transactionChanges);

        // Then it contains ONLY the merchant field's pre-edit value — not the whole snapshot
        expect(revert).toEqual({merchant: 'Old Merchant'});
        // And it does NOT include keys the command never touched, so a later description/receipt edit
        // applied to the live transaction (e.g. comment) is not clobbered by the revert
        expect(revert).not.toHaveProperty('comment');
        expect(revert).not.toHaveProperty('amount');
        expect(revert).not.toHaveProperty('currency');
    });

    it('reverts only the merchant field so a later receipt attach survives the failure revert', () => {
        // Given a queued transaction snapshot whose merchant field the command changed.
        // The receipt attach edits the live transaction's comment.receipt AFTER this write was queued,
        // so the snapshot still carries the pre-attach comment.
        const queuedSnapshot: OnyxTypes.Transaction = {
            transactionID: 'txnB',
            amount: 2500,
            merchant: 'Pre-Edit Merchant',
            comment: {comment: 'beforeReceiptAttach'},
            reportID: 'r2',
            created: '2024-02-01',
            type: 'TRIP',
        } as unknown as OnyxTypes.Transaction;
        const transactionChanges: TransactionChanges = {merchant: 'Edited Merchant'};

        // When the field-scoped revert value is built
        const revert = getChangedFieldsRevert(queuedSnapshot, transactionChanges);

        // Then it reverts ONLY merchant — the comment key (which a receipt attach would have updated on
        // the live transaction) is absent, so the newer receipt survives the failureData merge
        expect(revert).toEqual({merchant: 'Pre-Edit Merchant'});
        expect(revert).not.toHaveProperty('comment');
    });

    it('reverts multiple changed fields but still omits untouched ones', () => {
        // Given a snapshot where two fields were changed by the command
        const queuedSnapshot: OnyxTypes.Transaction = {
            transactionID: 'txnC',
            amount: 5000,
            currency: 'EUR',
            merchant: 'Snapshot Merchant',
            category: 'Snapshot Category',
            comment: {comment: 'keep me'},
            reportID: 'r3',
        } as unknown as OnyxTypes.Transaction;
        const transactionChanges: TransactionChanges = {merchant: 'New Merchant', category: 'New Category'};

        // When the field-scoped revert value is built
        const revert = getChangedFieldsRevert(queuedSnapshot, transactionChanges);

        // Then it reverts both changed fields to their snapshot values and omits the rest
        expect(revert).toEqual({merchant: 'Snapshot Merchant', category: 'Snapshot Category'});
        expect(revert).not.toHaveProperty('comment');
        expect(revert).not.toHaveProperty('amount');
    });

    it('returns an empty object when the transaction snapshot is missing', () => {
        // Given no queued snapshot (transaction is undefined/null)
        const transactionChanges: TransactionChanges = {merchant: 'New Merchant'};

        // When the revert is built
        const revert = getChangedFieldsRevert(undefined, transactionChanges);

        // Then nothing is reverted (no clobbering) — failureData only sets pendingFields/loading/errorFields
        expect(revert).toEqual({});
    });

    it('skips changed fields that are undefined on the snapshot', () => {
        // Given a snapshot where the changed field has no value
        const queuedSnapshot: OnyxTypes.Transaction = {
            transactionID: 'txnD',
            merchant: undefined,
            reportID: 'r4',
        } as unknown as OnyxTypes.Transaction;
        const transactionChanges: TransactionChanges = {merchant: 'New Merchant'};

        // When the revert is built
        const revert = getChangedFieldsRevert(queuedSnapshot, transactionChanges);

        // Then the undefined field is skipped (Onyx MERGE treats undefined as a no-op)
        expect(revert).toEqual({});
    });
});
