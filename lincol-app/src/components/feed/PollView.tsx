import { useState } from 'react';
import { api } from '../../lib/axios';

export interface PollOption {
    id: string;
    text: string;
    voteCount: number;
}

export interface PollData {
    id: string;
    postId: string;
    expiresAt: string;
    options: PollOption[];
    userVotedOptionId: string | null;
}

interface PollViewProps {
    poll: PollData;
    onVoteChange?: (pollId: string, optionId: string) => void;
}

export function PollView({ poll, onVoteChange }: PollViewProps) {
    const isExpired = new Date(poll.expiresAt) < new Date();
    const [votedOption, setVotedOption] = useState<string | null>(poll.userVotedOptionId);
    const [isVoting, setIsVoting] = useState(false);

    // optimistic updates to count
    const [options, setOptions] = useState<PollOption[]>(poll.options);

    const handleVote = async (optionId: string) => {
        if (isExpired || votedOption || isVoting) return;

        setIsVoting(true);
        try {
            await api.post(`/polls/${poll.id}/vote`, { optionId });
            setVotedOption(optionId);

            setOptions(prev => prev.map(opt =>
                opt.id === optionId
                    ? { ...opt, voteCount: opt.voteCount + 1 }
                    : opt
            ));

            onVoteChange?.(poll.id, optionId);
        } catch (error) {
            console.error('Failed to vote', error);
        } finally {
            setIsVoting(false);
        }
    };

    const totalVotes = options.reduce((sum, opt) => sum + opt.voteCount, 0);
    const showResults = isExpired || votedOption !== null;

    let highestVoteCount = 0;
    if (showResults) {
        highestVoteCount = Math.max(...options.map(o => o.voteCount));
    }

    return (
        <div className="mt-3 rounded-[16px] border border-border-subtle p-3">
            <div className="flex flex-col gap-2">
                {options.map((opt) => {
                    const percentage = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
                    const isWinning = showResults && opt.voteCount === highestVoteCount && highestVoteCount > 0;
                    const isUserChoice = votedOption === opt.id;

                    if (showResults) {
                        return (
                            <div key={opt.id} className="relative flex min-h-[36px] items-center overflow-hidden rounded-[8px] bg-bg-secondary">
                                <div
                                    className={`absolute bottom-0 left-0 top-0 transition-all duration-500 ease-in-out ${isWinning ? 'bg-brand/20' : 'bg-black/5'}`}
                                    style={{ width: `${percentage}%` }}
                                />
                                <div className="relative flex w-full items-center justify-between px-3 py-2 text-[14px]">
                                    <div className="flex items-center gap-1.5">
                                        <span className={`font-medium ${isWinning ? 'text-text-primary' : 'text-text-secondary'}`}>
                                            {opt.text}
                                        </span>
                                        {isUserChoice && (
                                            <span className="text-[12px] text-text-secondary">✓</span>
                                        )}
                                    </div>
                                    <span className="font-medium text-text-primary">{percentage}%</span>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                handleVote(opt.id);
                            }}
                            disabled={isVoting}
                            className="w-full rounded-[100px] border border-border-subtle py-2 text-center text-[15px] font-bold text-brand transition hover:bg-brand/10 disabled:opacity-50"
                        >
                            {opt.text}
                        </button>
                    );
                })}
            </div>

            <div className="mt-2 text-[13px] text-text-secondary">
                {totalVotes} oy · {isExpired ? 'Sona erdi' : 'Devam ediyor'}
            </div>
        </div>
    );
}
