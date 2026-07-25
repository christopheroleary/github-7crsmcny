export default function SearchBox({ value, onChange, placeholder = 'Search…', resultCount, totalCount }) {
  return (
    <div className="search-box">
      <svg className="search-box__icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="14" y1="14" x2="18.5" y2="18.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        className="search-box__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          type="button"
          className="search-box__clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
      {value && typeof resultCount === 'number' && (
        <span className="search-box__count">
          {resultCount} of {totalCount}
        </span>
      )}
    </div>
  );
}
