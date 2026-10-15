<!-- IMPORT emails/partials/header.tpl -->

<!-- Email Body : BEGIN -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width: 600px;">

	<!-- 1 Column Text + Button : BEGIN -->
	<tr>
		<td bgcolor="#0d0d0f">
			<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
				<tr>
					<td style="padding: 40px 40px 6px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 24px; line-height: 27px; color: #ffffff; font-weight: 800;">{{tx("email:greeting-with-name", txEscape(displayname))}}</h1>
					</td>
				</tr>
				<tr>
					<td style="padding: 0px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 0 0 10px 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 18px; line-height: 21px; color: #b4b4bd; font-weight: 800;">{{tx(concat("email:digest.title.", interval))}}</h1>
					</td>
				</tr>
				{{{ if notifications.length }}}
				<tr>
					<td style="padding: 0px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<ul style="margin: 0; padding: 0;">
							{{{ each notifications }}}
							<li style="text-decoration: none; list-style-type: none; padding-bottom: 0.5em;">
								<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
									<tr>
										<td style="padding: 16px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; width: 32px;">
											{{{ if notifications.image }}}
											<img style="vertical-align: middle; width: 32px; height: 32px; border-radius: 50%" src="{notifications.image}" alt="" />
											{{{ else }}}
											<div style="vertical-align: middle; width: 32px; height: 32px; line-height: 32px; font-size: 16px; background-color: {notifications.user.icon:bgColor}; color: white; text-align: center; display: inline-block; border-radius: 50%">{notifications.user.icon:text}</div>
											{{{ end }}}
										</td>
										<td style="padding: 16px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; line-height: 16px; color: #ffffff;">
											<p style="margin: 0;"><a style="text-decoration:none !important; text-decoration:none; color: #ffffff;" href="{notifications.notification_url}">{{notifications.bodyShort}}</a></p>
										</td>
									</tr>
								</table>
							</li>
							{{{ end }}}
						</ul>
					</td>
				</tr>
				{{{ end }}}
				{{{ if publicRooms.length }}}
				<tr>
					<td style="padding: 0px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 16px 0 24px 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 18px; line-height: 21px; color: #b4b4bd; font-weight: 800;">{{tx("email:digest.unread-rooms")}}</h1>
						<ul style="margin: 0; padding: 0;">
							{{{ each publicRooms }}}
							<li style="text-decoration: none; list-style-type: none; padding-bottom: 0.5em;">
								<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
									<tr>
										<td style="padding: 16px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; line-height: 16px; color: #ffffff;">
											<p style="margin: 0;"><a style="text-decoration:none !important; text-decoration:none; color: #ffffff;" href="{url}/chats/{./roomId}"># {{tx("email:digest.room-name-unreadcount", ./roomName, ./unreadCountText)}}</a></p>
										</td>
									</tr>
								</table>
							</li>
							{{{ end }}}
						</ul>
					</td>
				</tr>
				{{{ end }}}
				{{{ if topTopics.length }}}
				<tr>
					<td style="padding: 0px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 16px 0 24px 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 18px; line-height: 21px; color: #b4b4bd; font-weight: 800;">{{tx("email:digest.top-topics", site_title)}}</h1>
						<ul style="margin: 0; padding: 0;">
							{{{ each topTopics }}}
							<!-- IMPORT emails/partials/digest-topic.tpl -->
							{{{ end }}}
						</ul>
					</td>
				</tr>
				{{{ end }}}
				{{{ if popularTopics.length }}}
				<tr>
					<td style="padding: 0px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 16px 0 24px 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 18px; line-height: 21px; color: #b4b4bd; font-weight: 800;">{{tx("email:digest.popular-topics", site_title)}}</h1>
						<ul style="margin: 0; padding: 0;">
							{{{ each popularTopics }}}
							<!-- IMPORT emails/partials/digest-topic.tpl -->
							{{{ end }}}
						</ul>
					</td>
				</tr>
				{{{ end }}}
				{{{ if recent.length }}}
				<tr>
					<td style="padding: 0px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<h1 style="margin: 16px 0 24px 0; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 18px; line-height: 21px; color: #b4b4bd; font-weight: 800;">{{tx("email:digest.latest-topics", site_title)}}</h1>
						<ul style="margin: 0; padding: 0;">
							{{{ each recent }}}
							<!-- IMPORT emails/partials/digest-topic.tpl -->
							{{{ end }}}
						</ul>
					</td>
				</tr>
				{{{ end }}}
				<tr>
					<td style="padding: 32px 40px; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 15px; line-height: 20px; color: #dcdce2;">
						<!-- Button : BEGIN -->
						<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: auto;">
							<tr>
								<td style="border-radius: 999px; background: #ffffff; text-align: center;" class="button-td">
									<a href="{url}" style="background: #ffffff; border: 15px solid #ffffff; font-family: ui-rounded,'SF Pro Rounded',Nunito,'Varela Round','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif; font-size: 13px; line-height: 1.1; text-align: center; text-decoration: none; display: block; border-radius: 999px; font-weight: bold;" class="button-a">
										<span style="color:#000000;" class="button-link">{{tx("email:digest.cta", site_title)}} &rarr;</span>
									</a>
								</td>
							</tr>
						</table>
						<!-- Button : END -->
					</td>
				</tr>
			</table>
		</td>
	</tr>
	<!-- 1 Column Text + Button : END -->

</table>
<!-- Email Body : END -->

<!-- IMPORT emails/partials/footer.tpl -->
