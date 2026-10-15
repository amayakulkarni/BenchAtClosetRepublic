<li style="text-decoration: none; list-style-type: none; padding-bottom: 0.5em;">
	<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
		<tr>
			<td style="padding: 6px 16px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; width: 32px; vertical-align: middle;">{{renderDigestAvatar(@value)}}</td>
			<td style="padding: 6px 16px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; line-height: 16px; color: #ffffff;">
				<p style="margin: 0;"><a style="text-decoration:none !important; text-decoration:none; color: #ffffff;" href="{url}/topic/{./slug}"><strong>{./title}</strong></a></p>
				<p style="margin: 0; font-size: 12px;"><a style="text-decoration:none !important; text-decoration:none; color: #b4b4bd; line-height: 16px;" href="{url}/uid/{./teaser.user.uid}"><strong>{{txDisplayname(./teaser.user)}}</strong></a></p>
			</td>
		</tr>
		<tr>
			<td colspan="2" style="padding: 8px 16px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; line-height: 16px; color: #ffffff;">
				{{{ if ./teaser.contentWarning }}}
				<p style="margin: 0; padding: 6px 0px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 13px; line-height: 26px; color: #b4b4bd; font-style: italic;">⚠️ {./teaser.contentWarning}</p>
				{{{ end }}}
				<p style="margin: 0; padding: 6px 0px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 13px; line-height: 26px; color: #c9c9d0;">{./teaser.content}</p>
				<p style="margin: 0; padding: 6px 0px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; line-height: 16px;">
					<a style="text-decoration:none !important; text-decoration:none; text-transform: capitalize; color: #c9c9d0; line-height: 16px;" href="{url}/topic/{./slug}">
						<small><strong><span style="color: #b4b4bd;">&rsaquo;</span> {{tx("global:read-more")}}</strong></small>
					</a>
				</p>
			</td>
		</tr>
	</table>
</li>
{{{ if !@last }}}
<li style="text-decoration: none; list-style-type: none; margin: 0px 64px 16px 64px; border-bottom: 1px solid #2a2a2e"></li>
{{{ end }}}