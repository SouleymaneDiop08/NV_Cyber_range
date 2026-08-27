'use strict';

/**
 * Lancement authentifié depuis le portail Talixman.
 *
 * Le portail signe un jeton de courte durée avec le secret propre AU LABO, et
 * redirige le navigateur ici. Ce module le vérifie LOCALEMENT : aucun appel
 * sortant, aucun annuaire à joindre. C'est ce qui permet au réseau du
 * laboratoire de rester totalement cloisonné (`internal`).
 *
 * Module purement additif : rien de l'authentification native de FUXA n'est
 * modifié. Un utilisateur provisionné ici l'est SANS mot de passe, donc il ne
 * peut pas s'authentifier par /api/signin — seul le portail peut ouvrir sa
 * session.
 */

const express = require('express');
const jwt = require('jsonwebtoken');

const ISSUER = 'talixman-portal';
/** Marge de rejeu : au-delà, le jeton est de toute façon expiré (60 s côté portail). */
const REPLAY_RETENTION_MS = 180 * 1000;

var ssoApp;
var runtime;
var secretKey = null;
var audience = '';

/** jti déjà consommés -> date d'oubli. Borne la mémoire ET bloque le rejeu. */
const consumed = new Map();

function forget() {
    const now = Date.now();
    for (const [jti, until] of consumed) {
        if (until <= now) {
            consumed.delete(jti);
        }
    }
}

function init(_runtime) {
    runtime = _runtime;
    ssoApp = express();

    const rawSecret = process.env.LAB_SSO_SECRET || '';
    audience = process.env.LAB_SSO_AUDIENCE || '';
    // Pas de secret de repli : sans configuration, la route répond 503 plutôt
    // que d'accepter des jetons signés avec une valeur devinable.
    secretKey = rawSecret ? Buffer.from(rawSecret, 'hex') : null;

    if (!secretKey || !audience) {
        runtime.logger.warn('api-sso: lancement authentifié désactivé (secret ou audience absent)');
    } else {
        runtime.logger.info(`api-sso: lancement authentifié actif pour ${audience}`);
    }

    setInterval(forget, 60 * 1000).unref();

    ssoApp.get('/api/sso/callback', function (req, res) {
        // Le jeton transite en paramètre d'URL : on empêche sa fuite vers un
        // tiers par l'en-tête Referer, et sa conservation par un cache.
        res.set('Referrer-Policy', 'no-referrer');
        res.set('Cache-Control', 'no-store');

        if (!secretKey || !audience) {
            return deny(res, 503, 'Lancement authentifié non configuré sur ce composant.');
        }

        const token = req.query.token;
        if (!token || typeof token !== 'string') {
            return deny(res, 400, 'Lien de lancement incomplet.');
        }

        let claims;
        try {
            claims = jwt.verify(token, secretKey, {
                // Algorithme imposé : sans cette liste, un jeton présenté en
                // « none » ou en RS256 pourrait contourner la vérification.
                algorithms: ['HS256'],
                // Lie le jeton à CE composant de CE labo. Les superviseurs d'un
                // même labo partagent son secret : sans l'audience, un jeton
                // émis pour l'un serait rejouable sur les autres.
                audience: audience,
                issuer: ISSUER,
                clockTolerance: 5,
            });
        } catch (err) {
            // Jamais le jeton dans les journaux — seulement la raison.
            runtime.logger.error(`api-sso: jeton refusé (${err.message})`);
            return deny(res, 401, 'Lien de lancement invalide ou expiré.');
        }

        if (!claims.jti || consumed.has(claims.jti)) {
            return deny(res, 401, 'Lien de lancement déjà utilisé.');
        }
        consumed.set(claims.jti, Date.now() + REPLAY_RETENTION_MS);

        const username = String(claims.email || '').trim();
        const groups = Number(claims.groups);
        if (!username || !Number.isFinite(groups)) {
            return deny(res, 400, 'Lien de lancement incomplet.');
        }

        // Provisionnement local : `verifyGroups` refuse l'accès REST à un
        // utilisateur authentifié absent de la base de FUXA, même avec un jeton
        // valide. Aucun mot de passe n'est posé — la ligne reste donc
        // inutilisable par /api/signin (qui exige un mot de passe stocké).
        runtime.users.setUsers({
            username: username,
            fullname: String(claims.name || username),
            groups: groups,
            info: '{}',
        }).then(function () {
            const fuxaToken = jwt.sign(
                { id: username, groups: groups },
                runtime.settings.secretCode,
                { expiresIn: runtime.settings.tokenExpiresIn || 3600 },
            );
            runtime.logger.info(`api-sso: session ouverte pour ${username} (groupes ${groups})`);
            res.status(200).send(handoffPage({
                username: username,
                fullname: String(claims.name || username),
                groups: groups,
                info: '{}',
                token: fuxaToken,
            }));
        }).catch(function (err) {
            runtime.logger.error(`api-sso: provisionnement impossible (${err && err.message})`);
            deny(res, 500, 'Ouverture de session impossible.');
        });
    });

    return ssoApp;
}

function deny(res, code, message) {
    res.status(code).send(shell(`<h1>Accès refusé</h1><p>${escapeHtml(message)}</p>`));
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function shell(body) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Talixman SCADA</title>
<style>body{font-family:system-ui,sans-serif;background:#14161a;color:#e8e8ec;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#9a9aa6;font-size:14px;margin:0}</style>
</head><body><div>${body}</div></body></html>`;
}

/**
 * Page de relais : dépose la session comme le ferait /api/signin, puis remplace
 * l'entrée d'historique pour que le jeton disparaisse de la barre d'adresse.
 */
function handoffPage(profile) {
    // `<` échappé : une valeur contenant `</script>` fermerait sinon le bloc.
    const payload = JSON.stringify(profile).replace(/</g, '\\u003c');
    return shell(`<h1>Connexion en cours…</h1><p>Ouverture de votre session.</p>
<script>
(function () {
  try { sessionStorage.setItem('currentUser', ${JSON.stringify(payload)}); } catch (e) {}
  location.replace('/');
})();
</script>`);
}

module.exports = {
    init: init,
    app: function () { return ssoApp; },
};
