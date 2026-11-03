// Ventana con el reproductor de YouTube (dominio sin cookies de seguimiento).
export class Video extends EventTarget {
  constructor(contenedor) {
    super();
    this.el = document.createElement('div');
    this.el.className = 'video';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="video-caja" role="dialog" aria-modal="true" aria-label="Vídeo">
        <button class="video-cerrar" aria-label="Cerrar el vídeo">×</button>
        <div class="video-marco"></div>
      </div>`;
    contenedor.append(this.el);
    this.marco = this.el.querySelector('.video-marco');
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el || e.target.closest('.video-cerrar')) this.cerrar();
    });
  }

  get abierto() {
    return !this.el.hidden;
  }

  abrir(youtubeId, titulo) {
    const id = encodeURIComponent(youtubeId);
    this.marco.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1"
      title="${titulo.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    this.el.hidden = false;
  }

  cerrar() {
    this.marco.innerHTML = '';
    this.el.hidden = true;
    this.dispatchEvent(new Event('cerrado'));
  }
}
