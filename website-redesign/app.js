(() => {
  const menuButton = document.querySelector('[data-menu-button]');
  const menu = document.querySelector('[data-mobile-menu]');

  menuButton?.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    if (menu) menu.hidden = isOpen;
  });

  document.querySelectorAll('[data-scroll-to]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.querySelector(button.dataset.scrollTo);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.querySelectorAll('.mobile-menu a').forEach((link) => {
    link.addEventListener('click', () => {
      if (menu) menu.hidden = true;
      menuButton?.setAttribute('aria-expanded', 'false');
    });
  });

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });

  document.querySelectorAll('.reveal-up, .reveal-scale').forEach((el) => revealObserver.observe(el));

  const formatValue = (element, value) => {
    if (element.classList.contains('currency')) return `$${Math.round(value).toLocaleString()}`;
    if (element.classList.contains('savings-percent')) return `${Math.round(value)}%`;
    const target = Number(element.dataset.count || 0);
    return target === 98 ? `${Math.round(value)}%` : Math.round(value).toLocaleString();
  };

  const animateCount = (element) => {
    const target = Number(element.dataset.count || 0);
    const duration = 1100;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = formatValue(element, target * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };

  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        countObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.55 });

  document.querySelectorAll('[data-count]').forEach((el) => countObserver.observe(el));

  const sections = [...document.querySelectorAll('main section[id], main[id]')];
  const mobileLinks = [...document.querySelectorAll('.mobile-bottom-nav a')];

  const updateMobileNav = () => {
    const y = window.scrollY + 180;
    let current = '#home';
    sections.forEach((section) => {
      if (section.offsetTop <= y) current = `#${section.id}`;
    });
    mobileLinks.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === current));
  };

  window.addEventListener('scroll', updateMobileNav, { passive: true });
  updateMobileNav();
})();
