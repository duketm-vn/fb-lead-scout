import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ClipboardCopy, ExternalLink, LogOut, Radar, RefreshCw, Send } from 'lucide-react';
import type { BackgroundStatus, BgMessage, PageMessage, PageStatus, Reply } from '../../lib/messages';
import { MAX_POST_AGE_DAYS } from '../../lib/postTime';

const CRM_URL = import.meta.env.WXT_CRM_URL || 'https://taminhduc.com/admin/crm/fb-opportunities';

async function bg<T>(msg: BgMessage): Promise<T> {
  const reply = (await browser.runtime.sendMessage(msg)) as Reply<T>;
  if (!reply?.ok) throw new Error(reply?.error ?? 'Không liên lạc được với extension.');
  return reply.data;
}

// null = tab không phải facebook.com hoặc trang mở trước khi cài extension (chưa có content script).
async function page<T>(msg: PageMessage): Promise<T | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return (await browser.tabs.sendMessage(tab.id, msg)) as T;
  } catch {
    return null;
  }
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await bg({ type: 'auth:login', email: email.trim(), password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-sm text-slate-600">Đăng nhập bằng tài khoản admin CRM (taminhduc.com).</p>
      <input
        type="email"
        required
        autoFocus
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
      />
      <input
        type="password"
        required
        placeholder="Mật khẩu"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={busy}
        className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
    </form>
  );
}

function Counts({ status }: { status: PageStatus }) {
  return (
    <>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
        <dt>Bài đọc được</dt>
        <dd className="text-right font-medium text-slate-900">{status.found}</dd>
        <dt>Cũ hơn {MAX_POST_AGE_DAYS} ngày</dt>
        <dd className="text-right">{status.tooOld}</dd>
        <dt>Không rõ giờ đăng</dt>
        <dd className="text-right">{status.noTime}</dd>
        <dt>Chưa có id bài</dt>
        <dd className="text-right">{status.noId}</dd>
        <dt>Không có chữ</dt>
        <dd className="text-right">{status.noContent}</dd>
      </dl>
      {status.noId > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Facebook ẩn link bài tới khi rê chuột vào giờ đăng; bài sẽ được đọc khi link hiện ra.
        </p>
      )}
    </>
  );
}

function PageCard({ status }: { status: PageStatus | null }) {
  if (!status) {
    return (
      <p className="rounded-lg bg-white p-3 text-sm text-slate-500 ring-1 ring-slate-200">
        Mở News Feed hoặc một Facebook Group đang theo dõi để extension bắt đầu đọc. Tab mở trước khi cài/cập nhật
        extension thì tải lại trang.
      </p>
    );
  }
  if (!status.mode) {
    return (
      <p className="rounded-lg bg-white p-3 text-sm text-slate-500 ring-1 ring-slate-200">
        Extension chỉ đọc ở News Feed và trang group, trang này bị bỏ qua.
      </p>
    );
  }
  if (status.mode === 'feed') {
    return (
      <div className="rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
        <p className="font-medium text-emerald-700">● News Feed: chỉ đọc bài từ {status.watchedCount} group theo dõi</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Đã gặp bài từ {status.feedGroups} group
          {status.autoAdded > 0 && `, tự thêm ${status.autoAdded} group mới`}. Bài bạn bè, trang, quảng cáo bị bỏ qua.
        </p>
        <Counts status={status} />
      </div>
    );
  }
  if (!status.watchedName) {
    return (
      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
        Group <b>{status.groupKey}</b> không được theo dõi (chưa có, hoặc đã tắt ở CRM), extension không đọc gì ở đây.
        Bật lại ở CRM → Cơ hội FB → Group theo dõi, hoặc bật "Tự theo dõi" bên dưới, rồi tải lại trang.
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
      <p className="font-medium text-emerald-700">● Đang đọc: {status.watchedName}</p>
      <Counts status={status} />
    </div>
  );
}

export default function App() {
  const [bgStatus, setBgStatus] = useState<BackgroundStatus | null>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setBgStatus(await bg<BackgroundStatus>({ type: 'status' }));
      setPageStatus(await page<PageStatus>({ type: 'page:status' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await fn();
      if (done) setNote(done);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  async function copyDiagnosis() {
    const text = await page<string>({ type: 'page:diagnose' });
    if (!text) throw new Error('Mở trang group trên Facebook rồi thử lại.');
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="space-y-3 p-3">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
          <Radar size={18} /> FB Lead Scout
        </h1>
        {bgStatus?.email && (
          <button
            onClick={() => act(() => bg({ type: 'auth:logout' }))}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
            title={bgStatus.email}
          >
            <LogOut size={14} /> Đăng xuất
          </button>
        )}
      </header>

      {!bgStatus ? (
        <p className="text-sm text-slate-500">Đang tải…</p>
      ) : !bgStatus.email ? (
        <Login onDone={refresh} />
      ) : (
        <>
          <PageCard status={pageStatus} />

          <label className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={bgStatus.autoAdd}
              disabled={busy}
              onChange={(e) => act(() => bg({ type: 'settings:set', autoAdd: e.target.checked }))}
            />
            <span>
              <span className="font-medium text-slate-900">Tự theo dõi mọi group gặp được</span>
              <span className="block text-xs text-slate-500">
                Gặp bài từ group chưa có trong CRM thì tự thêm rồi đọc. Group đã tắt ở CRM không bị thêm lại. Đọc
                nhiều hơn thì phí chấm điểm cũng tăng. Tải lại tab Facebook sau khi đổi.
              </span>
            </span>
          </label>

          <div className="rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
            <p className="mb-1 font-medium text-slate-900">Hôm nay</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
              <dt>Đưa vào hàng đợi</dt>
              <dd className="text-right">{bgStatus.stats.queued}</dd>
              <dt>Đã gửi chấm điểm</dt>
              <dd className="text-right">{bgStatus.stats.sent}</dd>
              <dt>Cơ hội</dt>
              <dd className="text-right font-semibold text-emerald-700">{bgStatus.stats.opportunities}</dd>
              <dt>Đang chờ gửi</dt>
              <dd className="text-right">{bgStatus.queueSize}</dd>
            </dl>
            {bgStatus.lastSentAt && (
              <p className="mt-1 text-xs text-slate-400">
                Gửi lần cuối {new Date(bgStatus.lastSentAt).toLocaleTimeString('vi-VN')}
              </p>
            )}
          </div>

          {bgStatus.lastError && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{bgStatus.lastError}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {note && <p className="text-sm text-emerald-700">{note}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={busy || bgStatus.queueSize === 0}
              onClick={() => act(() => bg({ type: 'flush' }), 'Đã gửi xong hàng đợi.')}
              className="flex items-center justify-center gap-1 rounded bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-50"
            >
              <Send size={14} /> Gửi ngay
            </button>
            <a
              href={CRM_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1 rounded bg-white px-2 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
            >
              <ExternalLink size={14} /> Cơ hội FB
            </a>
            <button
              disabled={busy}
              onClick={() => act(copyDiagnosis, 'Đã chép chẩn đoán (không chứa nội dung bài), dán vào chat để gỡ lỗi.')}
              className="flex items-center justify-center gap-1 rounded bg-white px-2 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
            >
              <ClipboardCopy size={14} /> Sao chép chẩn đoán
            </button>
            <button
              disabled={busy}
              onClick={() => act(refresh)}
              className="flex items-center justify-center gap-1 rounded bg-white px-2 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
            >
              <RefreshCw size={14} /> Làm mới
            </button>
          </div>
        </>
      )}
    </div>
  );
}
