import React, { useRef, useState } from 'react';

const styles = {
  dropzone: {
    border: '2px dashed #334',
    borderRadius: 8,
    padding: '24px 16px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    background: 'rgba(255,255,255,0.02)',
    fontSize: 13,
    color: '#778',
  },
  dropzoneActive: {
    borderColor: '#4af',
    background: 'rgba(68,170,255,0.06)',
  },
  label: {
    display: 'block',
    fontSize: 11,
    color: '#556',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  preview: {
    width: '100%',
    height: 80,
    objectFit: 'cover',
    borderRadius: 4,
    marginTop: 8,
    border: '1px solid #223',
  },
  btn: {
    display: 'block',
    width: '100%',
    marginTop: 8,
    padding: '8px 0',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid #334',
    borderRadius: 4,
    color: '#aac',
    cursor: 'pointer',
    fontSize: 12,
    letterSpacing: '0.05em',
  },
};

function DropZone({ label, accept, onFile, preview, disabled }) {
  const inputRef = useRef(null);
  const [active, setActive] = useState(false);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    onFile(url, file);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <span style={styles.label}>{label}</span>
      <div
        style={{ ...styles.dropzone, ...(active ? styles.dropzoneActive : {}) }}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setActive(true); }}
        onDragLeave={() => setActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setActive(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        {preview
          ? <img src={preview} style={styles.preview} alt={label} />
          : <span>Drop or click to upload<br /><small style={{ color: '#446' }}>{accept}</small></span>
        }
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files[0])}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export default function ImageLoader({ onImage, imageSrc, disabled }) {
  return (
    <div>
      <DropZone
        label="Image (RGB)"
        accept="image/jpeg,image/png,image/webp"
        onFile={onImage}
        preview={imageSrc}
        disabled={disabled}
      />
    </div>
  );
}
