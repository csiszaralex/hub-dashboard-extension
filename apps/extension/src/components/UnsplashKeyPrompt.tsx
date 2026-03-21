import { useState, type SubmitEvent } from 'react';

export function UnsplashKeyPrompt({ onSave }: { onSave: (key: string) => void }) {
  const [key, setKey] = useState('');

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    if (key.trim()) {
      onSave(key.trim());
    }
  };

  return (
    <div className='absolute inset-0 flex items-center justify-center bg-black/60 z-50 text-white backdrop-blur-md'>
      <form
        onSubmit={handleSubmit}
        className='bg-white/10 p-8 rounded-2xl shadow-2xl flex flex-col gap-4 max-w-sm w-full border border-white/20'
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <h2 className='text-2xl font-semibold mb-2 shadow-sm'>Welcome to Hub</h2>
        <p className='text-sm text-white/80 mb-4'>
          Please enter your Unsplash Access Key to fetch backgrounds. You can get one for free at{' '}
          <a
            href='https://unsplash.com/developers'
            target='_blank'
            rel='noreferrer'
            className='underline hover:text-white'
          >
            unsplash.com/developers
          </a>
          .
        </p>
        <input
          type='text'
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder='Unsplash Access Key'
          className='px-4 py-2 rounded-lg bg-black/50 border border-white/20 focus:outline-none focus:border-white/50 text-white placeholder-white/50'
          autoFocus
        />
        <button
          type='submit'
          className='mt-2 bg-white/20 hover:bg-white/30 transition-colors py-2 rounded-lg font-medium'
        >
          Save Key
        </button>
      </form>
    </div>
  );
}
