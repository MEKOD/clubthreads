import { MessageCircle } from 'lucide-react';

export function MessagesThreadPlaceholder() {
    return (
        <div className="relative hidden h-full flex-1 items-center justify-center overflow-hidden bg-[#f3ebe4] md:flex dark:bg-[#050608]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(127,92,73,0.07)_1px,transparent_0)] bg-[length:26px_26px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.035)_1px,transparent_0)]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_32%,rgba(127,92,73,0.03)_66%,transparent_100%)] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_32%,rgba(79,134,255,0.04)_66%,transparent_100%)]" />
            <div className="relative max-w-md rounded-[28px] border border-[#ddcec2] bg-[#fffaf7]/90 px-8 py-10 text-center shadow-[0_18px_40px_rgba(70,46,31,0.08)] backdrop-blur-sm dark:border-[#1b1f27] dark:bg-[#0d0f14]/92 dark:shadow-none">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#dceff6] text-[#3a9fc8] dark:bg-[#18233a] dark:text-[#74a4ff]">
                    <MessageCircle size={26} />
                </div>
                <div className="text-[32px] font-black tracking-[-0.04em] text-[#2f2823] dark:text-[#f1f3f7]">
                    Bir sohbet sec
                </div>
                <p className="mt-3 text-sm leading-7 text-[#7c6657] dark:text-[#8c93a3]">
                    Sol taraftan bir sohbet ac. Yeni DM arayuzu artik yogun liste, yesil aksanlar ve sohbet duvar kagidi ile direkt chat moduna gecer.
                </p>
            </div>
        </div>
    );
}
