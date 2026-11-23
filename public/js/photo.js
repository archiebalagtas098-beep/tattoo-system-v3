// photos.js
// Photos Gallery - designs galing MongoDB.
// Admin lang ang may upload at delete. Ang client ay pumipili lang ng design.
//
// QUICK FIX (404 images):
//  - Ang eksaktong path na naka-save sa database ang unang sinusubukan,
//    bago ang mga hula na folder (kaya kakaunti na ang 404 sa console).
//  - Sinusuportahan na ang storage system (/api/storage/files/<storedName>).
//  - Kapag walang gumana, ililista sa console kung anong mga URL ang sinubukan
//    para madaling malaman kung aling file ang wala sa server.
//  - Ang upload ay hindi na babagsak kapag HTML ang isinagot ng server.

document.addEventListener('DOMContentLoaded', function () {

    var isAdmin = document.body.getAttribute('data-role') === 'admin';

    var designGrid = document.getElementById('designGrid');
    var noDesigns = document.getElementById('noDesigns');

    var uploadSection = document.getElementById('uploadSection');
    var uploadForm = document.getElementById('uploadForm');

    // Lalabas kung hindi ma-load ang image (SVG placeholder)
    var NO_IMAGE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
        '<rect width="100%" height="100%" fill="#222"/>' +
        '<text x="50%" y="50%" fill="#888" font-family="Arial" font-size="20" ' +
        'text-anchor="middle" dominant-baseline="middle">Image not found</text></svg>'
    );

    // ==================================================
    // LOGO - pindutin para pumunta sa Dashboard
    // ==================================================

    var logo = document.querySelector('.logo');

    if (logo) {
        var dashboardUrl = isAdmin ? '/dashboard' : '/clientdashboard';

        logo.setAttribute('role', 'link');
        logo.setAttribute('tabindex', '0');

        logo.addEventListener('click', function () {
            window.location.href = dashboardUrl;
        });

        logo.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                window.location.href = dashboardUrl;
            }
        });
    }

    if (!designGrid) {
        return;
    }

    // ==================================================
    // HELPERS
    // ==================================================

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Ligtas na pag-parse ng JSON (hindi babagsak kapag HTML ang isinagot)
    function parseJson(response, url) {
        return response.text().then(function (body) {
            try {
                return JSON.parse(body);
            } catch (e) {
                console.error('Non-JSON response from ' + url + ' (HTTP ' + response.status + '):',
                    body.slice(0, 500));
                return {
                    success: false,
                    message: 'Server error (HTTP ' + response.status + ') on ' + url + '.'
                };
            }
        });
    }

    function request(url, options) {
        var opts = options || {};
        opts.credentials = 'same-origin';

        return fetch(url, opts).then(function (response) {
            if (response.status === 401) {
                window.location.href = '/login';
                return null;
            }

            return parseJson(response, url);
        });
    }

    function unique(list) {
        return list.filter(function (url, index) {
            return url && list.indexOf(url) === index;
        });
    }

    // Listahan ng posibleng URL ng image, isa-isang susubukan.
    // Ang pinakamalamang na tama ang nasa unahan.
    function imageCandidates(photo) {
        var list = [];

        // 1) Galing sa storage system
        if (typeof photo.storedName === 'string' && photo.storedName.trim()) {
            list.push('/api/storage/files/' + encodeURIComponent(photo.storedName.trim()));
        }

        // 2) Ang field na naka-save sa database
        var keys = ['image', 'imageUrl', 'imagePath', 'photo', 'path', 'url', 'filename', 'file'];
        var raw = '';

        for (var i = 0; i < keys.length; i++) {
            var value = photo[keys[i]];

            if (typeof value === 'string' && value.trim()) {
                raw = value.trim();
                break;
            }
        }

        if (raw) {
            if (/^(data:|https?:\/\/)/i.test(raw)) {
                list.push(raw);

            } else if (/^(\/9j\/|iVBOR|R0lGOD|UklGR)/.test(raw)) {
                // Raw base64 na walang "data:" prefix
                list.push('data:image/jpeg;base64,' + raw);

            } else {
                var clean = raw.replace(/\\/g, '/')
                    .replace(/^\.?\/?public\//i, '')
                    .replace(/^\.\//, '');
                var base = clean.split('/').pop();

                if (/^\/?api\/storage\//i.test(clean)) {
                    list.push('/' + clean.replace(/^\//, ''));

                } else {
                    // Eksaktong path muna
                    if (clean.indexOf('/') !== -1) {
                        list.push('/' + clean.replace(/^\//, ''));
                    }

                    // Tapos ang mga posibleng folder
                    ['/uploads/', '/images/', '/uploads/photos/', '/img/'].forEach(function (folder) {
                        list.push(folder + base);
                    });
                }
            }
        }

        return unique(list);
    }

    function imageSrc(photo) {
        return imageCandidates(photo)[0] || NO_IMAGE;
    }

    function imgTag(photo) {
        var list = imageCandidates(photo);

        return '<img src="' + escapeHtml(list[0] || NO_IMAGE) + '" ' +
            'data-next="' + escapeHtml(list.slice(1).join('|')) + '" ' +
            'data-tried="' + escapeHtml(list.join(' , ')) + '" ' +
            'alt="' + escapeHtml(photo.title) + '" loading="lazy">';
    }

    // Kapag nag-error ang image, subukan ang susunod na URL
    function onImgError(event) {
        var img = event.target;

        if (!img || img.tagName !== 'IMG' || img.getAttribute('data-failed') === '1') {
            return;
        }

        var rest = (img.getAttribute('data-next') || '').split('|').filter(Boolean);

        if (rest.length) {
            img.setAttribute('data-next', rest.slice(1).join('|'));
            img.src = rest[0];
            return;
        }

        img.setAttribute('data-failed', '1');

        console.warn(
            'Image not found for design "' + (img.alt || '') + '". Tried: ' +
            (img.getAttribute('data-tried') || '(walang image field sa database)')
        );

        img.src = NO_IMAGE;
    }

    designGrid.addEventListener('error', onImgError, true);

    // ==================================================
    // RENDER
    // ==================================================

    function deleteButton(photo) {
        if (!isAdmin) {
            return '';
        }

        return '<button type="button" class="delete-btn" data-delete-id="' +
            escapeHtml(photo._id) + '">Delete</button>';
    }

    function renderDesigns(photos) {
        if (noDesigns) {
            noDesigns.style.display = photos.length ? 'none' : 'block';
        }

        designGrid.innerHTML = photos.map(function (photo) {
            // Ang client ay dinadala sa booking kasama ang napiling design.
            var chooseLink = isAdmin
                ? ''
                : '<a href="/clientdashboard?design=' + encodeURIComponent(photo.title) +
                      '&image=' + encodeURIComponent(imageSrc(photo)) +
                      '" class="choose-btn">Choose Design</a>';

            return '<div class="design-card">' +
                '<div class="photo-placeholder">' +
                    imgTag(photo) +
                '</div>' +
                '<div class="photo-info">' +
                    '<h3>' + escapeHtml(photo.title) + '</h3>' +
                    '<p>' + escapeHtml(photo.caption) + '</p>' +
                    chooseLink +
                    deleteButton(photo) +
                '</div>' +
            '</div>';
        }).join('');
    }

    // ==================================================
    // LOAD
    // ==================================================

    function load() {
        return request('/api/photos')
            .then(function (data) {
                if (!data) {
                    return;
                }

                if (!data.success) {
                    console.error(data.message);
                    return;
                }

                var photos = data.photos || [];

                renderDesigns(photos.filter(function (p) { return p.category === 'design'; }));
            })
            .catch(function (error) {
                console.error('Error loading photos:', error);
            });
    }

    // ==================================================
    // ADMIN - UPLOAD
    // ==================================================

    if (uploadSection) {
        uploadSection.style.display = isAdmin ? 'block' : 'none';
    }

    if (uploadForm && isAdmin) {
        uploadForm.addEventListener('submit', function (event) {
            event.preventDefault();

            var submitButton = uploadForm.querySelector('button[type="submit"]');

            if (submitButton) {
                submitButton.disabled = true;
            }

            request('/api/photos', {
                method: 'POST',
                body: new FormData(uploadForm)
            })
                .then(function (data) {
                    if (submitButton) {
                        submitButton.disabled = false;
                    }

                    if (!data) {
                        return;
                    }

                    if (!data.success) {
                        alert(data.message || 'Upload failed.');
                        return;
                    }

                    uploadForm.reset();
                    load();
                })
                .catch(function (error) {
                    console.error('Error uploading photo:', error);

                    if (submitButton) {
                        submitButton.disabled = false;
                    }

                    alert('An error occurred. Please try again.');
                });
        });
    }

    // ==================================================
    // ADMIN - DELETE
    // ==================================================

    designGrid.addEventListener('click', function (event) {
        var button = event.target.closest('[data-delete-id]');

        if (!button || !isAdmin) {
            return;
        }

        if (!confirm('Delete this design?')) {
            return;
        }

        request('/api/photos/' + encodeURIComponent(button.getAttribute('data-delete-id')), {
            method: 'DELETE'
        })
            .then(function (data) {
                if (!data) {
                    return;
                }

                if (!data.success) {
                    alert(data.message || 'Delete failed.');
                    return;
                }

                load();
            })
            .catch(function (error) {
                console.error('Error deleting photo:', error);
                alert('An error occurred. Please try again.');
            });
    });

    // ==================================================
    // INIT
    // ==================================================

    load();
});