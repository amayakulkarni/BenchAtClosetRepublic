<!DOCTYPE html>
<!-- Closet Republic email header: dark, with the soft prism stripe and the CR logo. Made from NodeBB 4.16.3's emails/partials/header.tpl. -->
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8"> <!-- utf-8 works for most cases -->
    <meta name="viewport" content="width=device-width"> <!-- Forcing initial-scale shouldn't be necessary -->
    <meta http-equiv="X-UA-Compatible" content="IE=edge"> <!-- Use the latest (edge) version of IE rendering engine -->
    <meta name="x-apple-disable-message-reformatting">  <!-- Disable auto-scale in iOS 10 Mail entirely -->
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>{site_title}</title> <!-- The title tag shows in email notifications, like Android 4.4. -->

    <!-- Web Font / @font-face : BEGIN -->
    <!-- NOTE: If web fonts are not required, lines 10 - 27 can be safely removed. -->

    <!-- Desktop Outlook chokes on web font references and defaults to Times New Roman, so we force a safe fallback font. -->
    <!--[if mso]>
        <style>
            * {
                font-family: sans-serif !important;
            }
        </style>
    <![endif]-->

    <!-- All other clients get the webfont reference; some will render the font and others will silently fail to the fallbacks. More on that here: http://stylecampaign.com/blog/2015/02/webfont-support-in-email/ -->
    <!--[if !mso]><!-->
        <!-- insert web font reference, eg: <link href='https://fonts.googleapis.com/css?family=Roboto:400,700' rel='stylesheet' type='text/css'> -->
    <!--<![endif]-->

    <!-- Web Font / @font-face : END -->

    <!-- CSS Reset -->
    <style>

        /* What it does: Remove spaces around the email design added by some email clients. */
        /* Beware: It can remove the padding / margin and add a background color to the compose a reply window. */
        :root {
            color-scheme: dark;
            supported-color-schemes: dark;
        }
        html,
        body {
            background: #000000 !important;
            margin: 0 auto !important;
            padding: 0 !important;
            height: 100% !important;
            width: 100% !important;
        }

        /* What it does: Stops email clients resizing small text. */
        * {
            -ms-text-size-adjust: 100%;
            -webkit-text-size-adjust: 100%;
        }

        /* What it does: Centers email on Android 4.4 */
        div[style*="margin: 16px 0"] {
            margin:0 !important;
        }

        /* What it does: Stops Outlook from adding extra spacing to tables. */
        table,
        td {
            mso-table-lspace: 0pt !important;
            mso-table-rspace: 0pt !important;
        }

        /* What it does: Fixes webkit padding issue. Fix for Yahoo mail table alignment bug. Applies table-layout to the first 2 tables then removes for anything nested deeper. */
        table {
            border-spacing: 0 !important;
            border-collapse: collapse !important;
            table-layout: fixed !important;
            margin: 0 auto !important;
        }
        table table table {
            table-layout: auto;
        }

        /* What it does: Uses a better rendering method when resizing images in IE. */
        img {
            -ms-interpolation-mode:bicubic;
        }

        /* What it does: A work-around for email clients meddling in triggered links. */
        *[x-apple-data-detectors],	/* iOS */
        .x-gmail-data-detectors, 	/* Gmail */
        .x-gmail-data-detectors *,
        .aBn {
            border-bottom: 0 !important;
            cursor: default !important;
            color: inherit !important;
            text-decoration: none !important;
            font-size: inherit !important;
            font-family: inherit !important;
            font-weight: inherit !important;
            line-height: inherit !important;
        }

        /* What it does: Prevents Gmail from displaying an download button on large, non-linked images. */
        .a6S {
            display: none !important;
            opacity: 0.01 !important;
        }
        /* If the above doesn't work, add a .g-img class to any image in question. */
        img.g-img + div {
            display:none !important;
           }

        /* What it does: Prevents underlining the button text in Windows 10 */
        .button-link {
            text-decoration: none !important;
        }

        /* What it does: Removes right gutter in Gmail iOS app: https://github.com/TedGoas/Cerberus/issues/89  */
        /* Create one of these media queries for each additional viewport size you'd like to fix */
        /* Thanks to Eric Lepetit (@ericlepetitsf) for help troubleshooting */
        @media only screen and (min-device-width: 375px) and (max-device-width: 413px) { /* iPhone 6 and 6+ */
            .email-container {
                min-width: 375px !important;
            }
        }

    </style>

    <!-- Progressive Enhancements -->
    <style>

        /* What it does: Hover styles for buttons */
        .button-td,
        .button-a {
            transition: all 100ms ease-in;
        }
        .button-td:hover,
        .button-a:hover {
            background: #e4e4e9 !important;
            border-color: #e4e4e9 !important;
        }

        /* Links in post text stay readable on black. */
        .email-container a {
            color: #ffffff;
        }

        /* Media Queries */
        @media screen and (max-width: 600px) {

            /* What it does: Adjust typography on small screens to improve readability */
            .email-container p {
                font-size: 17px !important;
                line-height: 26px !important;
            }
        }

        .notification-body img {
            max-width: 100%;
            height: auto;
        }
    </style>

    <!-- What it does: Makes background images in 72ppi Outlook render at correct size. -->
    <!--[if gte mso 9]>
    <xml>
        <o:OfficeDocumentSettings>
            <o:AllowPNG/>
            <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->

</head>

<body width="100%" bgcolor="#000000" style="margin: 0; mso-line-height-rule: exactly; background: #000000;">
    <center style="width: 100%; background: #000000; text-align: left;">

        <!--
            Set the email width. Defined in two places:
            1. max-width for all clients except Desktop Windows Outlook, allowing the email to squish on narrow but never go wider than 600px.
            2. MSO tags for Desktop Windows Outlook enforce a 600px width.
        -->
        <div style="max-width: 600px; margin: auto;{{{ if rtl }}} text-align: right; direction: rtl;{{{ end }}}" class="email-container">
            <!--[if mso]>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center">
            <tr>
            <td>
            <![endif]-->

            <!-- Email Header : BEGIN -->
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width: 600px;">
                <tr>
                    <td style="padding: 28px 0 20px; text-align: center">
                        <a href="{url}" style="text-decoration: none;">
                        {{{ if logo.src }}}
                        <img src="{logo.src}" height="auto" width="{logo.width}" alt="Closet Republic Forum" border="0" style="height: auto; width: {logo.width}px; background: #000000; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 20px; line-height: 24px; font-weight: 800; color: #ffffff;">
                        {{{ else }}}
                        <span style="font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 20px; line-height: 24px; font-weight: 800; color: #ffffff;">{site_title}</span>
                        {{{ end }}}
                        </a>
                    </td>
                </tr>
            </table>
            <!-- The prism: seven soft spectrum colours as a thin stripe above the message. -->
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width: 600px;">
                <tr>
                    <td height="4" bgcolor="#ff978f" style="height: 4px; font-size: 0; line-height: 0; background: #ff978f;">&nbsp;</td>
                    <td height="4" bgcolor="#ffb47f" style="height: 4px; font-size: 0; line-height: 0; background: #ffb47f;">&nbsp;</td>
                    <td height="4" bgcolor="#ffe680" style="height: 4px; font-size: 0; line-height: 0; background: #ffe680;">&nbsp;</td>
                    <td height="4" bgcolor="#94e3b0" style="height: 4px; font-size: 0; line-height: 0; background: #94e3b0;">&nbsp;</td>
                    <td height="4" bgcolor="#8cc2ff" style="height: 4px; font-size: 0; line-height: 0; background: #8cc2ff;">&nbsp;</td>
                    <td height="4" bgcolor="#aa9fff" style="height: 4px; font-size: 0; line-height: 0; background: #aa9fff;">&nbsp;</td>
                    <td height="4" bgcolor="#e09fff" style="height: 4px; font-size: 0; line-height: 0; background: #e09fff;">&nbsp;</td>
                </tr>
            </table>
            <!-- Email Header : END -->