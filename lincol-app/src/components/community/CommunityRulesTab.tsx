import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CommunityRule } from '../../lib/social';

interface CommunityRulesTabProps {
    rules: CommunityRule[];
    canModerate: boolean;
    saving: boolean;
    deletingRuleId: string | null;
    onCreateRule: (payload: { title: string; description: string }) => void;
    onUpdateRule: (ruleId: string, payload: { title: string; description: string }) => void;
    onDeleteRule: (ruleId: string) => void;
}

export function CommunityRulesTab({
    rules,
    canModerate,
    saving,
    deletingRuleId,
    onCreateRule,
    onUpdateRule,
    onDeleteRule,
}: CommunityRulesTabProps) {
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        if (!editingRuleId) {
            setTitle('');
            setDescription('');
            return;
        }

        const rule = rules.find((item) => item.id === editingRuleId);
        setTitle(rule?.title ?? '');
        setDescription(rule?.description ?? '');
    }, [editingRuleId, rules]);

    const handleSubmit = () => {
        const payload = { title: title.trim(), description: description.trim() };
        if (!payload.title || !payload.description) return;

        if (editingRuleId) {
            onUpdateRule(editingRuleId, payload);
        } else {
            onCreateRule(payload);
        }
    };

    return (
        <div className="space-y-3">
            {canModerate && (
                <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-5 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                    <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold text-text-primary">{editingRuleId ? 'Kurali duzenle' : 'Yeni kural ekle'}</div>
                        {editingRuleId && (
                            <button
                                type="button"
                                onClick={() => setEditingRuleId(null)}
                                className="rounded-full border border-border-subtle p-2 text-text-secondary transition hover:bg-bg-secondary"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <div className="space-y-3">
                        <input
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="Baslik"
                            className="w-full rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                        />
                        <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="Kural aciklamasi"
                            rows={3}
                            className="w-full resize-none rounded-2xl border border-black/[0.08] bg-bg-secondary px-4 py-3 text-sm outline-none placeholder:text-text-muted focus:border-black/20"
                        />
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={saving || !title.trim() || !description.trim()}
                            className="inline-flex items-center gap-2 rounded-full bg-text-primary px-4 py-2.5 text-sm font-semibold text-inverse-primary disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            {editingRuleId ? 'Guncelle' : 'Kural ekle'}
                        </button>
                    </div>
                </div>
            )}

            {rules.length === 0 ? (
                <div className="rounded-[24px] border border-black/[0.06] bg-bg-primary/90 px-5 py-12 text-center text-sm text-text-secondary shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                    Bu topluluk henuz kural eklememis.
                </div>
            ) : (
                rules.map((rule, index) => (
                    <div key={rule.id} className="rounded-[24px] border border-black/[0.06] bg-bg-primary/95 p-5 shadow-[0_8px_32px_rgba(17,17,17,0.04)]">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-bg-secondary text-sm font-black text-text-primary">
                                        {index + 1}
                                    </div>
                                    <div className="text-sm font-semibold text-text-primary">{rule.title}</div>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-text-secondary">{rule.description}</p>
                            </div>

                            {canModerate && (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setEditingRuleId(rule.id)}
                                        className="rounded-full border border-border-subtle p-2 text-text-secondary transition hover:bg-bg-secondary"
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteRule(rule.id)}
                                        disabled={deletingRuleId === rule.id}
                                        className="rounded-full border border-border-subtle p-2 text-text-secondary transition hover:bg-bg-secondary disabled:opacity-50"
                                    >
                                        {deletingRuleId === rule.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
